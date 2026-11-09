#!/usr/bin/env bash
# Xela Code: run Xela against your model server. Works from any directory.
#
#   xela-local                 interactive. First run on a machine without a local model:
#                              sign in with your XelaSphere account (browser) or enter a server by hand
#   xela-local -p "question"   one answer
#   xela-local --login         sign in with XelaSphere (https://api.xelasphere.com), saves the key
#   xela-local --logout        forget the saved server / key
#   xela-local --whoami        show the account, server and model in use
#   xela-local --setup         enter a server URL / API key by hand
#   xela-local --server URL --key KEY   one-off override (also saved)
#
# Env overrides (take precedence over the saved config):
#   XELA_SERVER_URL=...        default http://localhost:8080; a remote host never starts a server
#   LLAMA_API_KEY=...          key the server was started with (start-qwen.sh LLAMA_API_KEY)
#   XELA_CLOUD_URL=...         where --login signs in (default https://api.xelasphere.com)
#   XELA_CONFIG_DIR=...        config dir (default ~/.xela-local, separate from ~/.claude)
#   OPENAI_THINKING=off        no reasoning (faster, weaker on hard tasks)
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export CLAUDE_CONFIG_DIR="${XELA_CONFIG_DIR:-$HOME/.xela-local}"
SERVER_CONF="$CLAUDE_CONFIG_DIR/server.env"
CLOUD="${XELA_CLOUD_URL:-https://api.xelasphere.com}"
MODEL_FILE="${XELA_MODEL_FILE:-${XELA_MODELS_DIR:-$HOME/models}/Qwen3.6-27B-UD-Q4_K_XL.gguf}"
LOG="${XELA_SERVER_LOG:-${XELA_MODELS_DIR:-$HOME/models}/server.log}"
XELA_USER="${XELA_USER:-}"

# --- arguments handled here ---------------------------------------------------------------
MODE=run; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --login) MODE=login; shift ;;
    --logout) MODE=logout; shift ;;
    --whoami) MODE=whoami; shift ;;
    --setup) MODE=setup; shift ;;
    --server) XELA_SERVER_URL="$2"; MODE=flags; shift 2 ;;
    --key) LLAMA_API_KEY="$2"; MODE=flags; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

# --- saved config (env wins) -------------------------------------------------------------
conf_get() { sed -n "s/^$1=//p" "$SERVER_CONF" 2>/dev/null | tail -1; }
if [ -f "$SERVER_CONF" ]; then
  : "${XELA_SERVER_URL:=$(conf_get XELA_SERVER_URL)}"
  : "${LLAMA_API_KEY:=$(conf_get LLAMA_API_KEY)}"
  : "${XELA_USER:=$(conf_get XELA_USER)}"
fi
[ -z "${LLAMA_API_KEY:-}" ] && [ -f "${XELA_MODELS_DIR:-$HOME/models}/llama-api-key" ] && \
  LLAMA_API_KEY=$(cat "${XELA_MODELS_DIR:-$HOME/models}/llama-api-key")

auth_args() { [ -n "${LLAMA_API_KEY:-}" ] && printf '%s\n' -H "Authorization: Bearer $LLAMA_API_KEY"; }
health() { # $1 url: /v1/models requires the API key (unlike /health), so a wrong key fails here
  local a=(); [ -n "${LLAMA_API_KEY:-}" ] && a=(-H "Authorization: Bearer $LLAMA_API_KEY")
  curl -sf --connect-timeout 5 "${a[@]}" "$1/v1/models" >/dev/null 2>&1
}
health_code() { local a=(); [ -n "${LLAMA_API_KEY:-}" ] && a=(-H "Authorization: Bearer $LLAMA_API_KEY"); curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "${a[@]}" "$1/v1/models"; }
save_conf() {
  mkdir -p "$CLAUDE_CONFIG_DIR"
  printf 'XELA_SERVER_URL=%s\nLLAMA_API_KEY=%s\nXELA_USER=%s\n' "$XELA_SERVER_URL" "${LLAMA_API_KEY:-}" "${XELA_USER:-}" > "$SERVER_CONF"
  chmod 600 "$SERVER_CONF"
}
login() {
  command -v node >/dev/null || { echo "node is required for --login" >&2; exit 1; }
  local out
  out=$(node "$HERE/login.mjs" "$CLOUD") || exit 1
  XELA_SERVER_URL=$(printf '%s\n' "$out" | sed -n 's/^XELA_SERVER_URL=//p' | tail -1)
  LLAMA_API_KEY=$(printf '%s\n' "$out" | sed -n 's/^LLAMA_API_KEY=//p' | tail -1)
  XELA_USER=$(printf '%s\n' "$out" | sed -n 's/^XELA_USER=//p' | tail -1)
  [ -n "$XELA_SERVER_URL" ] && [ -n "$LLAMA_API_KEY" ] || { echo "login did not return a key" >&2; exit 1; }
  save_conf
  echo "  Saved to $SERVER_CONF. Model server: $XELA_SERVER_URL" >&2
}
manual_setup() {
  echo "" >&2
  echo "  Enter the address of a model server (llama-server started with local/start-qwen.sh)," >&2
  echo "  e.g. https://xxxx.ngrok-free.app or http://192.168.1.20:8080" >&2
  while :; do
    read -r -p "  Server URL [${XELA_SERVER_URL:-http://localhost:8080}]: " u </dev/tty
    XELA_SERVER_URL="${u:-${XELA_SERVER_URL:-http://localhost:8080}}"
    XELA_SERVER_URL="${XELA_SERVER_URL%/}"; XELA_SERVER_URL="${XELA_SERVER_URL%/v1}"
    read -r -s -p "  API key (empty if the server has none): " k </dev/tty; echo "" >&2
    [ -n "$k" ] && LLAMA_API_KEY="$k"
    if health "$XELA_SERVER_URL"; then
      XELA_USER=""; save_conf
      echo "  Connected. Saved to $SERVER_CONF (xela-local --setup to change)." >&2; echo "" >&2
      return 0
    fi
    echo "  Cannot reach $XELA_SERVER_URL with that key. Try again (Ctrl+C to quit)." >&2
  done
}
first_run() {
  echo "" >&2
  echo "  Welcome to Xela Code. How do you want to connect to a model?" >&2
  echo "" >&2
  echo "    1) Sign in with your XelaSphere account (recommended)  → $CLOUD" >&2
  echo "    2) Enter a model server URL and API key by hand" >&2
  echo "" >&2
  read -r -p "  Choice [1]: " c </dev/tty
  case "${c:-1}" in 2) manual_setup ;; *) login ;; esac
}

case "$MODE" in
  login) login ;;
  setup) manual_setup ;;
  logout) rm -f "$SERVER_CONF" && echo "Signed out: $SERVER_CONF removed." >&2; exit 0 ;;
  whoami)
    S="${XELA_SERVER_URL:-http://localhost:8080}"
    echo "server:  $S"; [ -n "$XELA_USER" ] && echo "account: $XELA_USER"
    curl -s --connect-timeout 5 $(auth_args) "$S/cli/me" 2>/dev/null | grep -q '"user"' && curl -s $(auth_args) "$S/cli/me" | sed 's/^/me:      /'
    echo "models:  HTTP $(health_code "$S")"; exit 0 ;;
  flags)
    XELA_SERVER_URL="${XELA_SERVER_URL:-http://localhost:8080}"
    health "$XELA_SERVER_URL" || { echo "Model server not reachable at $XELA_SERVER_URL" >&2; exit 1; }
    XELA_USER=""; save_conf ;;
esac

SERVER="${XELA_SERVER_URL:-http://localhost:8080}"
case "$SERVER" in
  http://localhost*|http://127.0.0.1*|http://0.0.0.0*) REMOTE=0 ;;
  *) REMOTE=1 ;;
esac

if ! health "$SERVER"; then
  if [ "$REMOTE" = "1" ]; then
    code=$(health_code "$SERVER")
    case "$code" in
      401|403) echo "Your key for $SERVER was rejected. Run: xela-local --login" >&2 ;;
      503) echo "The model server behind $SERVER is offline (the GPU machine is not connected). Try again later." >&2 ;;
      *) echo "Model server not reachable at $SERVER (HTTP $code). Is it (and the tunnel) running? xela-local --login / --setup to change it." >&2 ;;
    esac
    exit 1
  elif [ ! -f "$MODEL_FILE" ]; then
    first_run                      # no local model on this machine
    SERVER="$XELA_SERVER_URL"
  else
    echo "Starting the local model server (log: $LOG)..." >&2
    mkdir -p "$(dirname "$LOG")"
    nohup "$HERE/start-qwen.sh" > "$LOG" 2>&1 &
    for _ in $(seq 1 180); do health "$SERVER" && break; sleep 1; done
    health "$SERVER" || { echo "Server did not come up in 3 minutes. See $LOG" >&2; exit 1; }
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
