#!/usr/bin/env bash
# Run Xela against the local Qwen server (starts the server if it is not up).
# Works from any directory: Xela operates on the current directory.
#
#   xela-local                     interactive
#   xela-local -p "question"       one answer
#   OPENAI_THINKING=off xela-local no reasoning (faster, weaker on hard tasks)
#   XELA_CONFIG_DIR=...            config dir (default ~/.xela-local, separate from ~/.claude)
#   XELA_SERVER_URL=...            default http://localhost:8080; a remote host (http://192.168.1.20:8080)
#                                  uses that server and never starts one locally
#   LLAMA_API_KEY=...              key the server was started with (start-qwen.sh LLAMA_API_KEY)
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SERVER="${XELA_SERVER_URL:-http://localhost:8080}"
LOG="${XELA_SERVER_LOG:-${XELA_MODELS_DIR:-$HOME/models}/server.log}"

case "$SERVER" in
  http://localhost*|http://127.0.0.1*|http://0.0.0.0*) REMOTE=0 ;;
  *) REMOTE=1 ;;
esac
AUTH=()
[ -n "${LLAMA_API_KEY:-}" ] && AUTH=(-H "Authorization: Bearer $LLAMA_API_KEY")

if [ "$REMOTE" = "1" ]; then
  if ! curl -sf --connect-timeout 5 "${AUTH[@]}" "$SERVER/health" >/dev/null 2>&1; then
    echo "Model server not reachable at $SERVER (XELA_SERVER_URL). Is it running and is the port open?" >&2
    exit 1
  fi
elif ! curl -sf --connect-timeout 5 "${AUTH[@]}" "$SERVER/health" >/dev/null 2>&1; then
  echo "Starting the local model server (log: $LOG)..." >&2
  mkdir -p "$(dirname "$LOG")"
  nohup "$HERE/start-qwen.sh" > "$LOG" 2>&1 &
  for _ in $(seq 1 180); do
    curl -sf "$SERVER/health" >/dev/null 2>&1 && break
    sleep 1
  done
  if ! curl -sf "$SERVER/health" >/dev/null 2>&1; then
    echo "Server did not come up in 3 minutes. See $LOG" >&2
    exit 1
  fi
fi

# Variables inherited from a real Claude Code session would mix the two apps.
unset CLAUDE_CODE_MESSAGING_SOCKET CLAUDE_CODE_SESSION_KIND CLAUDE_CODE_SESSION_NAME CLAUDE_CODE_SESSION_LOG \
      CLAUDE_CODE_ENTRYPOINT CLAUDECODE CLAUDE_CODE_SSE_PORT CLAUDE_CODE_AGENT CLAUDE_PLAN_FILE 2>/dev/null

export CLAUDE_CONFIG_DIR="${XELA_CONFIG_DIR:-$HOME/.xela-local}"
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

CTX=$(curl -s --connect-timeout 5 "${AUTH[@]}" "$SERVER/props" | python3 -c "import sys,json;print(json.load(sys.stdin)['default_generation_settings']['n_ctx'])" 2>/dev/null)
CTX="${CTX:-65536}"
export OPENAI_CONTEXT_WINDOW="$CTX"
MAX_OUT=$(( CTX / 4 )); [ "$MAX_OUT" -lt 16384 ] && MAX_OUT=16384
export OPENAI_MAX_TOKENS="${OPENAI_MAX_TOKENS:-$MAX_OUT}"

exec "$ROOT/run.sh" "$@"
