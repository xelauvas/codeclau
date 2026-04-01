#!/bin/bash
# Xela — Uninstaller
set -e
echo "Removing xela..."
cd /opt/xela 2>/dev/null && sudo npm unlink -g 2>/dev/null || true
sudo rm -rf /opt/xela
sudo rm -f /usr/local/bin/xela
echo "Xela removed. Config preserved at ~/.xela/ (delete manually if wanted)"
