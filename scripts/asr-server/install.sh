#!/usr/bin/env bash
# Install the local dictation service as a launchd agent (macOS, Apple Silicon).
# Code and venv go to ~/.hapi/asr-server (outside ~/Documents, so launchd needs no TCC grant).
#
#   install / update:  scripts/asr-server/install.sh
#   status:            launchctl print gui/$(id -u)/com.haqi.asr | head
#   restart:           launchctl kickstart -k gui/$(id -u)/com.haqi.asr
#   remove:            launchctl bootout gui/$(id -u)/com.haqi.asr
#   log:               ~/.hapi/logs/asr-server.log
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.hapi/asr-server"
LABEL="com.haqi.asr"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

command -v uv >/dev/null || { echo "uv is required: brew install uv"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required: brew install ffmpeg"; exit 1; }

mkdir -p "$DEST" "$HOME/.hapi/logs"
cp "$HERE/server.py" "$HERE/requirements.txt" "$DEST/"
[ -f "$HOME/.hapi/asr-hotwords.txt" ] || cp "$HERE/hotwords.example.txt" "$HOME/.hapi/asr-hotwords.txt"

[ -d "$DEST/.venv" ] || uv venv -q -p 3.12 "$DEST/.venv"
uv pip install -q -p "$DEST/.venv/bin/python" -r "$DEST/requirements.txt"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$DEST/.venv/bin/python</string>
        <string>$DEST/server.py</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HAQI_ASR_MODEL</key><string>${HAQI_ASR_MODEL:-mlx-community/Qwen3-ASR-1.7B-8bit}</string>
        <key>HAQI_ASR_PORT</key><string>${HAQI_ASR_PORT:-18790}</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$HOME/.hapi/logs/asr-server.log</string>
    <key>StandardErrorPath</key><string>$HOME/.hapi/logs/asr-server.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# bootout returns before the old job is gone; bootstrap fails with "Bad request" until then.
for _ in $(seq 1 50); do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 0.2; done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL. The model loads in the background; check: curl -s 127.0.0.1:${HAQI_ASR_PORT:-18790}/health"
