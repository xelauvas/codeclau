#!/usr/bin/env bash
# Expose the model server (localhost:8080) on the internet through ngrok and print the public URL.
# The server must run with LLAMA_API_KEY: the key is the only protection of the public URL.
#   NGROK_DOMAIN=yourname.ngrok-free.app start-tunnel.sh   fixed URL (free static domain from the ngrok dashboard)
#   PORT=8080  XELA_MODELS_DIR=~/models                    defaults
set -u
PORT="${PORT:-8080}"
MODELS="${XELA_MODELS_DIR:-$HOME/models}"
command -v ngrok >/dev/null || { echo "ngrok is not installed: https://ngrok.com/download, then: ngrok config add-authtoken <token>" >&2; exit 1; }
pgrep -x llama-server >/dev/null || { echo "llama-server is not running; start it with start-qwen.sh" >&2; exit 1; }
KEY="${LLAMA_API_KEY:-$(cat "$MODELS/llama-api-key" 2>/dev/null)}"
[ -z "$KEY" ] && echo "WARNING: no API key (LLAMA_API_KEY or $MODELS/llama-api-key): the public URL will be open to everyone" >&2
pkill -x ngrok 2>/dev/null || true
DOM=(); [ -n "${NGROK_DOMAIN:-}" ] && DOM=(--url "https://$NGROK_DOMAIN")
nohup ngrok http "$PORT" "${DOM[@]}" --log "$MODELS/ngrok.log" --log-format json >/dev/null 2>&1 &
disown
URL=""
for _ in $(seq 1 15); do
  URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$URL" ] && break
  sleep 1
done
[ -z "$URL" ] && { echo "ngrok did not start:" >&2; grep -o '"err":"[^"]*"' "$MODELS/ngrok.log" | tail -3 >&2; exit 1; }
# ngrok answers 404 "tunnel not found" for a few seconds after start
for _ in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/v1/models")
  [ "$code" != "404" ] && [ "$code" != "000" ] && break
  sleep 1
done
AUTH=(); [ -n "$KEY" ] && AUTH=(-H "Authorization: Bearer $KEY")
echo "Public URL:    $URL"
echo "without key:   HTTP $(curl -s -o /dev/null -w '%{http_code}' "$URL/v1/models")  (expected 401)"
echo "with key:      HTTP $(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$URL/v1/models")  (expected 200)"
echo
echo "On another computer:  npm install -g @xelauvas/xela-cli && xela-local --server $URL --key <key>"
echo "Stop the tunnel:      pkill -x ngrok"
