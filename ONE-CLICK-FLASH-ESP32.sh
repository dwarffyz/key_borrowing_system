#!/usr/bin/env bash
# Cross-platform one-click ESP32 flasher for Linux and macOS.
# Optionally set ESP_PORT=/dev/ttyUSB0 before running when auto-detection is not desired.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/flash-esp.sh" "$@"
