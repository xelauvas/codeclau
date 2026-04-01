#!/bin/bash
# Interactive chat wrapper using -p mode with conversation continuity
# Works around the Ink TUI rendering issue

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$OPENAI_API_KEY" ]; then
  echo "Error: OPENAI_API_KEY is not set"
  echo "Usage: OPENAI_API_KEY=sk-... ./chat.sh"
  exit 1
fi

echo "╔══════════════════════════════════════════════╗"
echo "║  Claude Code (OpenAI Backend)                ║"
echo "║  Type your message, press Enter to send      ║"
echo "║  Type 'exit' or Ctrl+C to quit               ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

FIRST=1
while true; do
  printf "\033[1;36mYou>\033[0m "
  read -r input
  [ $? -ne 0 ] && echo "" && break
  [ -z "$input" ] && continue
  [ "$input" = "exit" ] && break
  [ "$input" = "quit" ] && break

  echo ""
  if [ "$FIRST" = "1" ]; then
    node --import "$SCRIPT_DIR/src/_shims/register.js" "$SCRIPT_DIR/start.js" \
      -p "$input" --dangerously-skip-permissions 2>/dev/null
    FIRST=0
  else
    node --import "$SCRIPT_DIR/src/_shims/register.js" "$SCRIPT_DIR/start.js" \
      -p "$input" -c --dangerously-skip-permissions 2>/dev/null
  fi
  echo ""
done

echo "Goodbye!"
