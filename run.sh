#!/bin/bash
# Run Claude Code with OpenAI backend
# Set OPENAI_API_KEY before running this script
# Optionally set OPENAI_MODEL (default: gpt-4o)

if [ -z "$OPENAI_API_KEY" ]; then
  echo "Error: OPENAI_API_KEY is not set"
  echo "Usage: OPENAI_API_KEY=sk-... ./run.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec node \
  --import "$SCRIPT_DIR/src/_shims/register.js" \
  "$SCRIPT_DIR/start.js" \
  "$@"
