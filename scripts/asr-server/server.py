"""Local dictation service for HAQI: speech in, text out, on Apple Silicon.

Runs Qwen3-ASR through mlx-audio and serves the two routes the web app calls:

    GET  /api/voice/dictation    -> {"available": true, "model": ...}
    POST /api/voice/transcribe   -> body: raw audio (webm/opus, mp4/aac, wav ...)
                                    query: hotwords=a,b,c (optional), language=zh (optional)
                                 <- {"text": ..., "audioSeconds": ..., "elapsedSeconds": ...}

Segmented dictation uses the same route, so the hub proxy needs no change. While recording,
the browser sends each recorder chunk with ?stream=<id>&seq=<n>; about every 5 s of audio the
service turns the next segment into text. The last chunk adds &final=1 and gets the whole text
back, so after the user stops only the last few seconds are left to transcribe.
&cancel=1 drops a stream.

The hub proxies both routes to this service. A tunnel can also route them here
directly, so every request is checked: the bearer token must be accepted by the hub.

It also serves a small standalone test page at / (static/index.html). The page logs in
through POST /api/auth, which this service forwards to the hub unchanged.

Settings (env):
    HAQI_ASR_MODEL     default mlx-community/Qwen3-ASR-1.7B-8bit
    HAQI_ASR_HOST      default 127.0.0.1
    HAQI_ASR_PORT      default 18790
    HAQI_ASR_HUB_URL   default http://127.0.0.1:3006 (used to check tokens)
    HAQI_ASR_WIRED_GB  default 5 (GB of model memory kept out of swap; 0 turns it off)
    HAQI_ASR_KEEP_WARM_SECONDS  default 60 (idle seconds before a 1 s silent run keeps the model hot; 0 turns it off)
    HAQI_ASR_SEGMENT_SECONDS  default 5 (target segment length while recording; 0 turns segments off)
    HAQI_ASR_HOTWORDS  path to a file with one hotword per line (default ~/.hapi/asr-hotwords.txt)
"""

import asyncio
import hashlib
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from contextlib import asynccontextmanager

import numpy as np
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

MODEL_ID = os.environ.get("HAQI_ASR_MODEL", "mlx-community/Qwen3-ASR-1.7B-8bit")
HOST = os.environ.get("HAQI_ASR_HOST", "127.0.0.1")
PORT = int(os.environ.get("HAQI_ASR_PORT", "18790"))
HUB_URL = os.environ.get("HAQI_ASR_HUB_URL", "http://127.0.0.1:3006").rstrip("/")
# Keep the model resident: on a busy Mac the weights otherwise get swapped out and a 3 s request takes 15 s.
# The model is 2.4 GB; a 40 s recording in one piece peaks at 3.9 GB.
WIRED_GB = float(os.environ.get("HAQI_ASR_WIRED_GB", "5"))
# The wired limit alone does not stop it: after hours idle the first request still took 13-52 s.
# A short silent run every minute keeps the weights and kernels hot.
KEEP_WARM_SECONDS = float(os.environ.get("HAQI_ASR_KEEP_WARM_SECONDS", "60"))
SEGMENT_SECONDS = float(os.environ.get("HAQI_ASR_SEGMENT_SECONDS", "5"))
HOTWORDS_FILE = Path(os.environ.get("HAQI_ASR_HOTWORDS", str(Path.home() / ".hapi" / "asr-hotwords.txt")))

MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_AUDIO_SECONDS = 10 * 60
MAX_HOTWORDS = 80
TOKEN_CACHE_SECONDS = 300
SAMPLE_RATE = 16000
FRAME = SAMPLE_RATE // 20  # 50 ms, the step for finding a quiet cut point
TAIL_SAMPLES = int(0.3 * SAMPLE_RATE)  # the newest audio may end mid-frame; never cut inside it
SILENCE_POWER = 1e-5  # mean power below this in every frame: the segment has no speech
PAUSE_RATIO = 0.01  # a frame quieter than 1% of the typical speech power counts as a pause
SENTENCE_PAUSE_SECONDS = 0.4  # a cut in a pause this long may end a sentence
WORD_GAP_SECONDS = 0.15  # a shorter pause is a gap inside a phrase
CONTEXT_CHARS = 120  # text of earlier segments given to the model, so a segment reads on from the last
STREAM_IDLE_SECONDS = 10 * 60
STATIC_DIR = Path(__file__).resolve().parent / "static"

model = None
# MLX runs one generation at a time; requests queue behind this lock.
model_lock = asyncio.Lock()
valid_tokens: dict[str, float] = {}
last_run = 0.0


@asynccontextmanager
async def lifespan(_app):
    tasks = [asyncio.create_task(load_model_in_background()), asyncio.create_task(keep_warm())]
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(lifespan=lifespan)


def log(msg: str) -> None:
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} [asr] {msg}", flush=True)


def load_hotwords() -> list[str]:
    try:
        lines = HOTWORDS_FILE.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def hub_accepts(authorization: str) -> bool:
    """Ask the hub whether this bearer token is valid. Valid tokens are cached for a few minutes."""
    key = hashlib.sha256(authorization.encode()).hexdigest()
    now = time.time()
    if valid_tokens.get(key, 0) > now:
        return True
    req = urllib.request.Request(
        f"{HUB_URL}/api/settings/project-offline",
        headers={"authorization": authorization},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            ok = res.status == 200
    except urllib.error.HTTPError:
        ok = False
    except OSError as error:
        log(f"hub check failed: {error}")
        ok = False
    if ok:
        valid_tokens[key] = now + TOKEN_CACHE_SECONDS
    return ok


async def authorized(request: Request) -> bool:
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        return False
    return await asyncio.to_thread(hub_accepts, authorization)


def decode_to_wav(audio: bytes) -> tuple[str, float]:
    """Decode any browser recording to 16 kHz mono wav with ffmpeg. Returns (path, seconds)."""
    src = tempfile.NamedTemporaryFile(suffix=".audio", delete=False)
    src.write(audio)
    src.close()
    dst = src.name + ".wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src.name,
             "-t", str(MAX_AUDIO_SECONDS), "-ar", str(SAMPLE_RATE), "-ac", "1", dst],
            check=True, capture_output=True, timeout=60,
        )
    finally:
        os.unlink(src.name)
    seconds = (os.path.getsize(dst) - 44) / (SAMPLE_RATE * 2)
    return dst, max(seconds, 0.0)


def transcribe_file(path: str, hotwords: list[str], language: str | None) -> str:
    kwargs = {}
    if hotwords:
        kwargs["hotwords"] = hotwords
    if language:
        kwargs["language"] = language
    result = model.generate(path, **kwargs)
    return (result.text if hasattr(result, "text") else str(result)).strip()


# ---- Segmented dictation ----

class Stream:
    def __init__(self, hotwords: list[str], language: str | None):
        self.audio = bytearray()
        self.next_seq = 0
        self.done = 0  # samples already turned into text
        self.texts: list[str] = []
        self.hotwords = hotwords
        self.language = language
        self.seen = time.time()
        self.worker: asyncio.Task | None = None


streams: dict[str, Stream] = {}


def decode_pcm(audio: bytes) -> np.ndarray:
    """Decode a browser recording, possibly still growing, to 16 kHz mono float32 samples."""
    src = tempfile.NamedTemporaryFile(suffix=".audio", delete=False)
    src.write(audio)
    src.close()
    try:
        out = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-i", src.name, "-t", str(MAX_AUDIO_SECONDS),
             "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "1", "pipe:1"],
            capture_output=True, timeout=60,
        )
    finally:
        os.unlink(src.name)
    # A recording that is still growing ends mid-frame; ffmpeg complains but decodes the rest.
    if out.returncode != 0 and not out.stdout:
        raise RuntimeError(out.stderr.decode(errors="replace")[-300:])
    return np.frombuffer(out.stdout, dtype=np.float32)


def frame_power(pcm: np.ndarray) -> np.ndarray:
    n = len(pcm) // FRAME
    return (pcm[: n * FRAME].reshape(n, FRAME) ** 2).mean(axis=1) if n else np.zeros(0)


def pick_cut(pcm: np.ndarray, start: int) -> tuple[int, float] | None:
    """End of the next segment, between 0.6x and 1.4x the segment length: the middle of the
    longest pause there, else the quietest 50 ms, so a cut rarely falls inside a word.
    Returns (cut sample, pause seconds); None while there is not enough audio yet."""
    lo = start + int(SEGMENT_SECONDS * 0.6 * SAMPLE_RATE)
    hi = min(len(pcm) - TAIL_SAMPLES, start + int(SEGMENT_SECONDS * 1.4 * SAMPLE_RATE))
    power = frame_power(pcm[lo:hi]) if hi > lo else np.zeros(0)
    if len(power) == 0:
        return None
    speech = frame_power(pcm[start:hi])
    speech = speech[speech > SILENCE_POWER]
    quiet = power < max(SILENCE_POWER, PAUSE_RATIO * float(np.median(speech))) if len(speech) else power < SILENCE_POWER
    best, best_len, run = 0, 0, 0
    for i, q in enumerate(quiet):
        run = run + 1 if q else 0
        if run > best_len:
            best, best_len = i - run + 1, run
    if best_len == 0:
        return lo + int(power.argmin()) * FRAME + FRAME // 2, 0.0
    return lo + (best * FRAME) + (best_len * FRAME) // 2, best_len * FRAME / SAMPLE_RATE


def fix_segment_end(text: str, pause: float) -> str:
    """The model ends every segment as if it were a sentence. Keep its mark only at a long pause;
    at a short pause the mark becomes a comma, and a cut inside speech gets no mark."""
    if pause >= SENTENCE_PAUSE_SECONDS:
        return text
    body = text.rstrip("。．.！!？?，,、")
    if pause < WORD_GAP_SECONDS or body == text or not body:
        return body
    cjk = re.match(r"[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]", body[-1])
    return body + ("，" if cjk else ",")


def join_texts(parts: list[str]) -> str:
    """No space next to CJK text or punctuation, one space between other words."""
    out = ""
    for part in (p.strip() for p in parts):
        if not part:
            continue
        if out and not (re.match(r"[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]", out[-1])
                        or re.match(r"[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]", part[0])):
            out += " "
        out += part
    return out


async def transcribe_segment(s: Stream, segment: np.ndarray, pause: float | None = None) -> None:
    """Turn a segment into text. `pause` is the pause the segment was cut at; None for the last one."""
    global last_run
    if len(segment) < TAIL_SAMPLES or frame_power(segment).max(initial=0) < SILENCE_POWER:
        return
    context = join_texts(s.texts)[-CONTEXT_CHARS:] or None
    kwargs = {"system_prompt": context}
    if s.hotwords:
        kwargs["hotwords"] = s.hotwords
    if s.language:
        kwargs["language"] = s.language
    async with model_lock:
        result = await asyncio.to_thread(model.generate, segment, **kwargs)
        last_run = time.time()
    text = (result.text if hasattr(result, "text") else str(result)).strip()
    if text and pause is not None:
        text = fix_segment_end(text, pause)
    if text:
        s.texts.append(text)


async def run_ready_segments(s: Stream) -> None:
    """Background work while recording: turn every full segment into text, until no new audio arrived."""
    try:
        while True:
            size = len(s.audio)
            pcm = await asyncio.to_thread(decode_pcm, bytes(s.audio))
            while len(pcm) - s.done >= int(SEGMENT_SECONDS * SAMPLE_RATE) + TAIL_SAMPLES:
                picked = pick_cut(pcm, s.done)
                if picked is None:
                    break
                cut, pause = picked
                await transcribe_segment(s, pcm[s.done:cut], pause)
                s.done = cut
            if len(s.audio) == size:
                return
    except Exception as error:  # the final request decodes everything again, so a failed early pass loses nothing
        log(f"segment pass failed: {error}")


async def stream_request(request: Request, stream_id: str):
    query = request.query_params
    now = time.time()
    for key in [k for k, v in streams.items() if now - v.seen > STREAM_IDLE_SECONDS]:
        streams.pop(key)
    if query.get("cancel"):
        streams.pop(stream_id, None)
        return {"stream": True}

    seq = int(query.get("seq", "-1"))
    s = streams.get(stream_id)
    if s is None and seq == 0:
        extra = [w.strip() for w in query.get("hotwords", "").split(",") if w.strip()]
        s = streams[stream_id] = Stream(list(dict.fromkeys(load_hotwords() + extra))[:MAX_HOTWORDS],
                                        query.get("language") or None)
    if s is None or seq != s.next_seq:
        return JSONResponse({"error": "Unknown stream or chunk out of order"}, status_code=409)
    chunk = await request.body()
    if len(s.audio) + len(chunk) > MAX_AUDIO_BYTES:
        streams.pop(stream_id, None)
        return JSONResponse({"error": "Audio is too large"}, status_code=413)
    s.audio += chunk
    s.next_seq += 1
    s.seen = now

    if not query.get("final"):
        if s.worker is None or s.worker.done():
            s.worker = asyncio.create_task(run_ready_segments(s))
        return {"stream": True, "segments": len(s.texts)}

    started = time.time()
    streams.pop(stream_id, None)
    if s.worker is not None:
        await s.worker
    try:
        pcm = await asyncio.to_thread(decode_pcm, bytes(s.audio))
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        log(f"decode failed: {error}")
        return JSONResponse({"error": "Could not decode audio"}, status_code=400)
    early = len(s.texts)
    await transcribe_segment(s, pcm[s.done:])
    text = join_texts(s.texts)
    seconds = len(pcm) / SAMPLE_RATE
    elapsed = time.time() - started
    log(f"stream: {len(s.audio)} bytes, {seconds:.1f}s audio, {early} segments early, "
        f"last {(len(pcm) - s.done) / SAMPLE_RATE:.1f}s at the end, {elapsed:.2f}s wait, {len(text)} chars")
    return {"stream": True, "text": text, "audioSeconds": round(seconds, 2), "elapsedSeconds": round(elapsed, 2)}


@app.get("/api/voice/dictation")
async def dictation_status(request: Request):
    if not await authorized(request):
        return JSONResponse({"error": "Invalid token"}, status_code=401)
    return {"available": model is not None, "model": MODEL_ID, "segmentSeconds": SEGMENT_SECONDS}


@app.post("/api/voice/transcribe")
async def transcribe(request: Request):
    global last_run
    if not await authorized(request):
        return JSONResponse({"error": "Invalid token"}, status_code=401)
    if model is None:
        return JSONResponse({"error": "Model is still loading"}, status_code=503)
    stream_id = request.query_params.get("stream")
    if stream_id and SEGMENT_SECONDS > 0:
        return await stream_request(request, stream_id)

    audio = await request.body()
    if not audio:
        return JSONResponse({"error": "Empty audio"}, status_code=400)
    if len(audio) > MAX_AUDIO_BYTES:
        return JSONResponse({"error": "Audio is too large"}, status_code=413)

    query = request.query_params
    extra = [w.strip() for w in query.get("hotwords", "").split(",") if w.strip()]
    hotwords = list(dict.fromkeys(load_hotwords() + extra))[:MAX_HOTWORDS]
    language = query.get("language") or None

    started = time.time()
    try:
        wav, seconds = await asyncio.to_thread(decode_to_wav, audio)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        log(f"decode failed: {error}")
        return JSONResponse({"error": "Could not decode audio"}, status_code=400)

    try:
        if seconds < 0.3:
            text = ""
        else:
            async with model_lock:
                text = await asyncio.to_thread(transcribe_file, wav, hotwords, language)
                last_run = time.time()
    finally:
        os.unlink(wav)

    elapsed = time.time() - started
    log(f"{len(audio)} bytes, {seconds:.1f}s audio, {elapsed:.2f}s, {len(text)} chars")
    return {"text": text, "audioSeconds": round(seconds, 2), "elapsedSeconds": round(elapsed, 2)}


@app.get("/")
async def test_page():
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.post("/api/auth")
async def auth(request: Request):
    """Forward the test page's login to the hub, so the page needs only this one origin."""
    body = await request.body()

    def forward():
        req = urllib.request.Request(
            f"{HUB_URL}/api/auth", data=body, method="POST",
            headers={"content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, res.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    status, payload = await asyncio.to_thread(forward)
    return Response(payload, status_code=status, media_type="application/json")


@app.get("/health")
async def health():
    return {"status": "ok" if model is not None else "loading", "model": MODEL_ID}


def make_silence() -> str:
    path = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                    f"anullsrc=r={SAMPLE_RATE}:cl=mono", "-t", "1", path], check=True)
    return path


async def keep_warm():
    """While idle, run the model on 1 s of silence every KEEP_WARM_SECONDS so the next request is not cold."""
    global last_run
    if KEEP_WARM_SECONDS <= 0:
        return
    silence = await asyncio.to_thread(make_silence)
    try:
        while True:
            await asyncio.sleep(KEEP_WARM_SECONDS / 4)
            if model is None or time.time() - last_run < KEEP_WARM_SECONDS or model_lock.locked():
                continue
            async with model_lock:
                started = time.time()
                await asyncio.to_thread(model.generate, silence)
                last_run = time.time()
            if last_run - started > 3:
                log(f"keep-warm run took {last_run - started:.1f}s (model was cold)")
    finally:
        os.unlink(silence)


async def load_model_in_background():
    global model
    import mlx.core as mx
    from mlx_audio.stt.utils import load_model
    if WIRED_GB > 0:
        mx.set_wired_limit(int(WIRED_GB * 1024 ** 3))
    started = time.time()
    loaded = await asyncio.to_thread(load_model, MODEL_ID)
    # One short run compiles the kernels, so the first real request is fast.
    silence = make_silence()
    await asyncio.to_thread(loaded.generate, silence)
    os.unlink(silence)
    model = loaded
    log(f"loaded {MODEL_ID} in {time.time() - started:.1f}s")


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
