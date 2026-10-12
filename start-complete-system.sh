#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Unix equivalent of start-complete-system.bat. Enabling the systemd service
# (Linux) or LaunchAgent (macOS) also starts it immediately.
case "${1:-}" in
  ''|--enable-autostart)
    exec /usr/bin/env bash "$ROOT_DIR/scripts/install-autostart.sh"
    ;;
  *)
    printf '[error] Unknown option: %s\n' "$1" >&2
    printf 'Usage: ./start-complete-system.sh\n' >&2
    exit 1
    ;;
esac
