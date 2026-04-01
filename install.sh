#!/bin/bash
# Xela — One-line installer
# curl -fsSL https://raw.githubusercontent.com/xelauvas/codeclau/main/install.sh | bash
set -e

REPO="xelauvas/codeclau"
INSTALL_DIR="/opt/xela"
BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}"
echo "  ▐▛███▜▌   Xela Installer"
echo "  ▝▜█████▛▘  AI coding assistant"
echo "    ▘▘ ▝▝"
echo -e "${RESET}"

# Check dependencies
for cmd in node npm git; do
  if ! command -v $cmd &>/dev/null; then
    echo "Error: $cmd is required but not installed."
    if [ "$cmd" = "node" ] || [ "$cmd" = "npm" ]; then
      echo "Install Node.js: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs"
    elif [ "$cmd" = "git" ]; then
      echo "Install git: sudo apt install -y git"
    fi
    exit 1
  fi
done

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Error: Node.js 20+ required (found v$NODE_VERSION)"
  echo "Upgrade: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs"
  exit 1
fi

# Clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only
else
  echo "Cloning xela..."
  sudo rm -rf "$INSTALL_DIR"
  sudo git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
  sudo chown -R "$USER:$USER" "$INSTALL_DIR" 2>/dev/null || true
fi

# Install dependencies
echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm install --production 2>&1 | tail -1

# Link globally
echo "Linking xela globally..."
sudo npm link 2>/dev/null || npm link

# Verify
if command -v xela &>/dev/null; then
  echo ""
  echo -e "${GREEN}${BOLD}Xela installed successfully!${RESET}"
  echo ""
  echo "  Get started:"
  echo "    xela              # interactive mode"
  echo "    xela \"fix bug\"    # with prompt"
  echo ""
  echo "  Config: ~/.xela/config (created on first run)"
  echo ""
  echo "  Providers:"
  echo "    OpenRouter (free)  — sign up at openrouter.ai"
  echo "    Groq (free)        — sign up at console.groq.com"
  echo "    Ollama (local)     — install at ollama.com"
  echo ""
  echo -e "  Run ${BOLD}xela${RESET} to start!"
else
  echo "Warning: xela not found in PATH. Try: sudo npm link"
fi
