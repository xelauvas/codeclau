#!/usr/bin/env bash
# Start a local Qwen3.6-27B as an OpenAI-compatible server on http://localhost:8080/v1
# using llama.cpp. Tuned for a 24 GB GPU.
#
#   XELA_MODELS_DIR   where the GGUF files live            (default ~/models)
#   LLAMA_SERVER      llama-server binary                  (default ~/llama.cpp/build/bin/llama-server)
#   MODEL             main model file                      (default Qwen3.6-27B-UD-Q4_K_XL.gguf)
#   MTP_MODEL         MTP draft head for speculative decoding (default mtp-Qwen3.6-27B-Q8_0.gguf)
#   CTX               context length (default 131072); MTP is enabled automatically at <= 65536
#   MTP=0|1           force speculative decoding on/off (both do not fit in 24 GB at 128k)
#   PORT              default 8080
#   LLAMA_API_KEY     if set, clients must send it as a Bearer token (use it when exposing the port)
#
# Modes on a 24 GB card:
#   CTX=131072 (default)  no MTP   ~31 tok/s, large context, rare compactions
#   CTX=65536             + MTP    ~47 tok/s, auto-compact kicks in more often
set -u
MODELS="${XELA_MODELS_DIR:-$HOME/models}"
BIN="${LLAMA_SERVER:-$HOME/llama.cpp/build/bin/llama-server}"
MODEL_FILE="$MODELS/${MODEL:-Qwen3.6-27B-UD-Q4_K_XL.gguf}"
MTP_FILE="$MODELS/${MTP_MODEL:-mtp-Qwen3.6-27B-Q8_0.gguf}"
CTX="${CTX:-131072}"
PORT="${PORT:-8080}"
if [ -z "${MTP:-}" ]; then
  [ "$CTX" -le 65536 ] && MTP=1 || MTP=0
fi
[ -x "$BIN" ] || { echo "llama-server not found at $BIN (set LLAMA_SERVER). See local/README.md." >&2; exit 1; }
[ -f "$MODEL_FILE" ] || { echo "model not found: $MODEL_FILE (set XELA_MODELS_DIR / MODEL). See local/README.md." >&2; exit 1; }
KEY=()
[ -n "${LLAMA_API_KEY:-}" ] && KEY=(--api-key "$LLAMA_API_KEY")
SPEC=()
if [ "$MTP" = "1" ] && [ -f "$MTP_FILE" ]; then
  SPEC=(-md "$MTP_FILE" --spec-type draft-mtp)
fi
exec "$BIN" \
  -m "$MODEL_FILE" \
  "${SPEC[@]}" "${KEY[@]}" \
  --alias qwen3.6-27b \
  -ngl 99 \
  -c "$CTX" \
  -fa on \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  --cache-reuse 256 \
  --cache-ram 0 --no-cache-idle-slots \
  --jinja \
  --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0 \
  --host 0.0.0.0 --port "$PORT"
