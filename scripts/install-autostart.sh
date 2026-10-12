#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$ROOT_DIR/scripts/start-autostart.sh"
SERVICE_NAME="key-borrowing-system"

die() { printf '\n[error] %s\n' "$*" >&2; exit 1; }
log() { printf '\n[autostart] %s\n' "$*"; }

[[ -x "$LAUNCHER" ]] || die "Autostart launcher is missing or not executable: $LAUNCHER"

case "$(uname -s)" in
  Linux)
    command -v systemctl >/dev/null 2>&1 || die 'systemd is required for Linux autostart.'
    SERVICE_USER="${SUDO_USER:-$USER}"
    [[ -n "$SERVICE_USER" && "$SERVICE_USER" != 'root' ]] || die 'Run this as your normal user with sudo, not directly as root.'
    id "$SERVICE_USER" >/dev/null 2>&1 || die "User does not exist: $SERVICE_USER"
    SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
    log "Installing systemd service for user $SERVICE_USER..."
    sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=BatStateU Key Borrowing System
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory="$ROOT_DIR"
Environment="HOME=$(eval echo "~$SERVICE_USER")"
Environment=KBS_NO_PAUSE=1
Environment=KBS_NO_BROWSER=1
ExecStart="$LAUNCHER"
Restart=on-failure
RestartSec=10
TimeoutStartSec=180

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable --now "$SERVICE_NAME.service"
    log 'Autostart is enabled. Check status with: sudo systemctl status key-borrowing-system'
    ;;
  Darwin)
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST_FILE="$PLIST_DIR/com.batstateu.key-borrowing-system.plist"
    mkdir -p "$PLIST_DIR"
    mkdir -p "$ROOT_DIR/.tools"
    log 'Installing macOS LaunchAgent...'
    cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.batstateu.key-borrowing-system</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$LAUNCHER</string></array>
  <key>WorkingDirectory</key><string>$ROOT_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT_DIR/.tools/autostart.log</string>
  <key>StandardErrorPath</key><string>$ROOT_DIR/.tools/autostart-error.log</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)" "$PLIST_FILE" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"
    log 'Autostart is enabled. It will run whenever you sign in.'
    ;;
  *) die "Unsupported operating system: $(uname -s)" ;;
esac
