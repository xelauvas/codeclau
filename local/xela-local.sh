#!/usr/bin/env bash
# Run Xela against your own model server (llama-server). Works from any directory.
#
#   xela-local                     interactive (first run on a machine without a GPU asks for
#                                  the server URL + API key once and saves them, like a login)
#   xela-local -p "question"       one answer
#   xela-local --setup             enter the server URL / API key again
#   xela-local --server URL --key KEY   one-off override (also saved for next time)
#
# Env overrides (take precedence over the saved config):
#   XELA_SERVER_URL=...            default http://localhost:8080; a remote host never starts a server
#   LLAMA_API_KEY=...              key the server was started with (start-qwen.sh LLAMA_API_KEY)
#   XELA_CONFIG_DIR=...            config dir (default ~/.xela-local, separate from ~/.claude)
#   OPENAI_THINKING=off            no reasoning (faster, weaker on hard tasks)
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export CLAUDE_CONFIG_DIR="${XELA_CONFIG_DIR:-$HOME/.xela-local}"
SERVER_CONF="$CLAUDE_CONFIG_DIR/server.env"
MODEL_FILE="${XELA_MODEL_FILE:-${XELA_MODELS_DIR:-$HOME/models}/Qwen3.6-27B-UD-Q4_K_XL.gguf}"
LOG="${XELA_SERVER_LOG:-${XELA_MODELS_DIR:-$HOME/models}/server.log}"

# --- arguments handled here: --setup, --server, --key -------------------------------------
SETUP=0; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --setup) SETUP=1; shift ;;
    --server) XELA_SERVER_URL="$2"; SETUP=2; shift 2 ;;
    --key) LLAMA_API_KEY="$2"; SETUP=2; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

# --- saved config (env wins) -------------------------------------------------------------
if [ -f "$SERVER_CONF" ]; then
  SAVED_URL=$(sed -n 's/^XELA_SERVER_URL=//p' "$SERVER_CONF" | tail -1)
  SAVED_KEY=$(sed -n 's/^LLAMA_API_KEY=//p' "$SERVER_CONF" | tail -1)
  : "${XELA_SERVER_URL:=$SAVED_URL}"
  : "${LLAMA_API_KEY:=$SAVED_KEY}"
fi
[ -z "${LLAMA_API_KEY:-}" ] && [ -f "${XELA_MODELS_DIR:-$HOME/models}/llama-api-key" ] && \
  LLAMA_API_KEY=$(cat "${XELA_MODELS_DIR:-$HOME/models}/llama-api-key")

health() { # $1 url, $2 key
  local a=(); [ -n "$2" ] && a=(-H "Authorization: Bearer $2")
  # /v1/models requires the API key (unlike /health), so a wrong key fails here, not later
  curl -sf --connect-timeout 5 "${a[@]}" "$1/v1/models" >/dev/null 2>&1
}
save_conf() {
  mkdir -p "$CLAUDE_CONFIG_DIR"
  printf 'XELA_SERVER_URL=%s\nLLAMA_API_KEY=%s\n' "$XELA_SERVER_URL" "${LLAMA_API_KEY:-}" > "$SERVER_CONF"
  chmod 600 "$SERVER_CONF"
}
setup() {
  echo "" >&2
  echo "  Xela needs a model server (llama-server started with local/start-qwen.sh)." >&2
  echo "  Enter its address, e.g. https://xxxx.ngrok-free.app or http://192.168.1.20:8080" >&2
  echo "" >&2
  while :; do
    read -r -p "  Server URL [${XELA_SERVER_URL:-http://localhost:8080}]: " u </dev/tty
    XELA_SERVER_URL="${u:-${XELA_SERVER_URL:-http://localhost:8080}}"
    XELA_SERVER_URL="${XELA_SERVER_URL%/}"; XELA_SERVER_URL="${XELA_SERVER_URL%/v1}"
    read -r -s -p "  API key (empty if the server has none): " k </dev/tty; echo "" >&2
    [ -n "$k" ] && LLAMA_API_KEY="$k"
    if health "$XELA_SERVER_URL" "${LLAMA_API_KEY:-}"; then
      save_conf
      echo "  Connected. Saved to $SERVER_CONF (xela-local --setup to change)." >&2
      echo "" >&2
      return 0
    fi
    echo "  Cannot reach $XELA_SERVER_URL with that key. Try again (Ctrl+C to quit)." >&2
  done
}

if [ "$SETUP" = "1" ]; then
  setup
elif [ "$SETUP" = "2" ]; then
  XELA_SERVER_URL="${XELA_SERVER_URL:-http://localhost:8080}"
  health "$XELA_SERVER_URL" "${LLAMA_API_KEY:-}" || { echo "Model server not reachable at $XELA_SERVER_URL" >&2; exit 1; }
  save_conf
fi

SERVER="${XELA_SERVER_URL:-http://localhost:8080}"
case "$SERVER" in
  http://localhost*|http://127.0.0.1*|http://0.0.0.0*) REMOTE=0 ;;
  *) REMOTE=1 ;;
esac

if ! health "$SERVER" "${LLAMA_API_KEY:-}"; then
  if [ "$REMOTE" = "1" ]; then
    echo "Model server not reachable at $SERVER. Is it (and the tunnel) running? Run xela-local --setup to change it." >&2
    exit 1
  elif [ ! -f "$MODEL_FILE" ]; then
    # No local model on this machine: first run → ask where the server is.
    setup
    SERVER="$XELA_SERVER_URL"
  else
    echo "Starting the local model server (log: $LOG)..." >&2
    mkdir -p "$(dirname "$LOG")"
    nohup "$HERE/start-qwen.sh" > "$LOG" 2>&1 &
    for _ in $(seq 1 180); do
      health "$SERVER" "${LLAMA_API_KEY:-}" && break
      sleep 1
    done
    if ! health "$SERVER" "${LLAMA_API_KEY:-}"; then
      echo "Server did not come up in 3 minutes. See $LOG" >&2
      exit 1
    fi
  fi
fi
AUTH=(); [ -n "${LLAMA_API_KEY:-}" ] && AUTH=(-H "Authorization: Bearer $LLAMA_API_KEY")

# Variables inherited from a real Claude Code session would mix the two apps.
unset CLAUDE_CODE_MESSAGING_SOCKET CLAUDE_CODE_SESSION_KIND CLAUDE_CODE_SESSION_NAME CLAUDE_CODE_SESSION_LOG \
      CLAUDE_CODE_ENTRYPOINT CLAUDECODE CLAUDE_CODE_SSE_PORT CLAUDE_CODE_AGENT CLAUDE_PLAN_FILE 2>/dev/null

if [ ! -f "$CLAUDE_CONFIG_DIR/.claude.json" ]; then
  mkdir -p "$CLAUDE_CONFIG_DIR"
  echo '{"hasCompletedOnboarding": true, "numStartups": 1}' > "$CLAUDE_CONFIG_DIR/.claude.json"
fi
if [ ! -f "$CLAUDE_CONFIG_DIR/settings.json" ]; then
  echo '{"theme": "dark", "skipAutoPermissionPrompt": true, "permissions": {"defaultMode": "auto"}}' > "$CLAUDE_CONFIG_DIR/settings.json"
fi

export DISABLE_INSTALLATION_CHECKS=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1
export DISABLE_LOGIN_COMMAND=1 DISABLE_LOGOUT_COMMAND=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export OPENAI_API_KEY="${OPENAI_API_KEY:-${LLAMA_API_KEY:-local}}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-$SERVER/v1}"
export OPENAI_MODEL="${OPENAI_MODEL:-qwen3.6-27b}"

# Real context size of the server (drives the context indicator and auto-compact); no python needed
CTX=$(curl -s --connect-timeout 5 "${AUTH[@]}" "$SERVER/props" | grep -o '"n_ctx":[0-9]*' | head -1 | cut -d: -f2)
CTX="${CTX:-65536}"
export OPENAI_CONTEXT_WINDOW="$CTX"
MAX_OUT=$(( CTX / 4 )); [ "$MAX_OUT" -lt 16384 ] && MAX_OUT=16384
export OPENAI_MAX_TOKENS="${OPENAI_MAX_TOKENS:-$MAX_OUT}"

exec "$ROOT/run.sh" "$@"
