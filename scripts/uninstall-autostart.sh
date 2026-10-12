#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="key-borrowing-system"

case "$(uname -s)" in
  Linux)
    sudo systemctl disable --now "$SERVICE_NAME.service" 2>/dev/null || true
    sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    sudo systemctl daemon-reload
    printf '[autostart] Disabled Linux autostart.\n'
    ;;
  Darwin)
    plist="$HOME/Library/LaunchAgents/com.batstateu.key-borrowing-system.plist"
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    rm -f "$plist"
    printf '[autostart] Disabled macOS autostart.\n'
    ;;
  *) printf '[error] Unsupported operating system.\n' >&2; exit 1 ;;
esac
