#!/bin/bash
# Run Claude Code with any OpenAI-compatible backend
#
# Providers (auto-detected from key prefix or OPENAI_BASE_URL):
#
#   OpenAI:      OPENAI_API_KEY=sk-proj-...
#   Groq (free): OPENAI_API_KEY=gsk_...
#   OpenRouter:  OPENAI_API_KEY=sk-or-...
#   DeepSeek:    OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.deepseek.com
#   Moonshot:    OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.moonshot.cn/v1
#   Ollama:      OPENAI_API_KEY=ollama OPENAI_BASE_URL=http://localhost:11434/v1
#   Mistral:     OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.mistral.ai/v1
#   Together:    OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.together.xyz/v1
#
# Optional: OPENAI_MODEL=model-name (auto-detected per provider)

if [ -z "$OPENAI_API_KEY" ]; then
  echo "Error: OPENAI_API_KEY is not set"
  echo ""
  echo "Usage examples:"
  echo "  OPENAI_API_KEY=sk-...  ./run.sh              # OpenAI (gpt-4o)"
  echo "  OPENAI_API_KEY=gsk_... ./run.sh              # Groq free (llama-3.3-70b)"
  echo "  OPENAI_API_KEY=sk-or-... ./run.sh            # OpenRouter"
  echo "  OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.deepseek.com ./run.sh  # DeepSeek"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec node \
  --import "$SCRIPT_DIR/src/_shims/register.js" \
  "$SCRIPT_DIR/start.js" \
  "$@"
