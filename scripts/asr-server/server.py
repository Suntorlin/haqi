"""Local dictation service for HAQI: speech in, text out, on Apple Silicon.

Runs Qwen3-ASR through mlx-audio and serves the two routes the web app calls:

    GET  /api/voice/dictation    -> {"available": true, "model": ...}
    POST /api/voice/transcribe   -> body: raw audio (webm/opus, mp4/aac, wav ...)
                                    query: hotwords=a,b,c (optional), language=zh (optional)
                                 <- {"text": ..., "audioSeconds": ..., "elapsedSeconds": ...}

The hub proxies both routes to this service. A tunnel can also route them here
directly, so every request is checked: the bearer token must be accepted by the hub.

It also serves a small standalone test page at / (static/index.html). The page logs in
through POST /api/auth, which this service forwards to the hub unchanged.

Settings (env):
    HAQI_ASR_MODEL     default mlx-community/Qwen3-ASR-1.7B-8bit
    HAQI_ASR_HOST      default 127.0.0.1
    HAQI_ASR_PORT      default 18790
    HAQI_ASR_HUB_URL   default http://127.0.0.1:3006 (used to check tokens)
    HAQI_ASR_WIRED_GB  default 4 (GB of model memory kept out of swap; 0 turns it off)
    HAQI_ASR_KEEP_WARM_SECONDS  default 60 (idle seconds before a 1 s silent run keeps the model hot; 0 turns it off)
    HAQI_ASR_HOTWORDS  path to a file with one hotword per line (default ~/.hapi/asr-hotwords.txt)
"""

import asyncio
import hashlib
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

MODEL_ID = os.environ.get("HAQI_ASR_MODEL", "mlx-community/Qwen3-ASR-1.7B-8bit")
HOST = os.environ.get("HAQI_ASR_HOST", "127.0.0.1")
PORT = int(os.environ.get("HAQI_ASR_PORT", "18790"))
HUB_URL = os.environ.get("HAQI_ASR_HUB_URL", "http://127.0.0.1:3006").rstrip("/")
# Keep the model resident: on a busy Mac the weights otherwise get swapped out and a 3 s request takes 15 s.
WIRED_GB = float(os.environ.get("HAQI_ASR_WIRED_GB", "4"))
# The wired limit alone does not stop it: after hours idle the first request still took 13-52 s.
# A short silent run every minute keeps the weights and kernels hot.
KEEP_WARM_SECONDS = float(os.environ.get("HAQI_ASR_KEEP_WARM_SECONDS", "60"))
HOTWORDS_FILE = Path(os.environ.get("HAQI_ASR_HOTWORDS", str(Path.home() / ".hapi" / "asr-hotwords.txt")))

MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_AUDIO_SECONDS = 10 * 60
MAX_HOTWORDS = 80
TOKEN_CACHE_SECONDS = 300
SAMPLE_RATE = 16000
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


@app.get("/api/voice/dictation")
async def dictation_status(request: Request):
    if not await authorized(request):
        return JSONResponse({"error": "Invalid token"}, status_code=401)
    return {"available": model is not None, "model": MODEL_ID}


@app.post("/api/voice/transcribe")
async def transcribe(request: Request):
    global last_run
    if not await authorized(request):
        return JSONResponse({"error": "Invalid token"}, status_code=401)
    if model is None:
        return JSONResponse({"error": "Model is still loading"}, status_code=503)

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
