#!/usr/bin/env bash
# Keep a reverse SSH tunnel from this GPU machine to the XelaSphere server, so that
# 127.0.0.1:11434 on the server == the local llama-server (:8080). The server's
# api.xelasphere.com and the xelasphere.com chat then use this machine's model.
#
#   xela-link              run in foreground (Ctrl+C stops it)
#   xela-link --daemon     run in background, log in $XELA_MODELS_DIR/link.log
#   xela-link --stop       stop the background tunnel
#   xela-link --status     is the tunnel up?
#
#   XELA_LINK_HOST=65.108.88.221 XELA_LINK_PORT=2222 XELA_LINK_USER=xela
#   XELA_LINK_KEY=~/.ssh/xela_link      passphrase-less key, restricted to port-forwarding on the server
#   XELA_LINK_REMOTE_PORT=11434 PORT=8080
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
MODELS="${XELA_MODELS_DIR:-$HOME/models}"
HOST="${XELA_LINK_HOST:-65.108.88.221}"; SSHPORT="${XELA_LINK_PORT:-2222}"; USER_="${XELA_LINK_USER:-xela}"
KEY="${XELA_LINK_KEY:-$HOME/.ssh/xela_link}"
RPORT="${XELA_LINK_REMOTE_PORT:-11434}"; LPORT="${PORT:-8080}"
LOG="$MODELS/link.log"; PIDFILE="$MODELS/link.pid"

status() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "link: running (pid $(cat "$PIDFILE"))"; else echo "link: not running"; return 1; fi
}
case "${1:-}" in
  --status) status; exit $? ;;
  --stop) [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null && rm -f "$PIDFILE" && echo "link stopped" || echo "link not running"; exit 0 ;;
  --daemon)
    status >/dev/null && { status; exit 0; }
    mkdir -p "$MODELS"; nohup "$0" >> "$LOG" 2>&1 &
    echo $! > "$PIDFILE"; disown; echo "link started in background (log: $LOG)"; exit 0 ;;
esac

[ -f "$KEY" ] || { echo "missing key $KEY (ssh-keygen -t ed25519 -N '' -f $KEY, then add the .pub to $USER_@$HOST authorized_keys)" >&2; exit 1; }
# Make sure the model server is up (start it if this machine has the model).
if ! curl -sf --connect-timeout 3 "localhost:$LPORT/health" >/dev/null 2>&1; then
  if [ -x "$HERE/start-qwen.sh" ] && [ -f "$MODELS/Qwen3.6-27B-UD-Q4_K_XL.gguf" ]; then
    echo "$(date '+%F %T') starting llama-server..." ; nohup "$HERE/start-qwen.sh" >> "$MODELS/server.log" 2>&1 &
  else
    echo "$(date '+%F %T') WARNING: nothing listening on localhost:$LPORT; the tunnel will connect anyway" >&2
  fi
fi
echo "$(date '+%F %T') tunnel $USER_@$HOST:$SSHPORT  remote 127.0.0.1:$RPORT -> local 127.0.0.1:$LPORT"
trap 'exit 0' INT TERM
while :; do
  ssh -N -T -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY" -p "$SSHPORT" \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
      -R "127.0.0.1:$RPORT:127.0.0.1:$LPORT" "$USER_@$HOST"
  echo "$(date '+%F %T') tunnel exited ($?), reconnecting in 5s"; sleep 5
done
