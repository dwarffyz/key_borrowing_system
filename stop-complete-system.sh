#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  ''|--disable-autostart)
    exec /usr/bin/env bash "$ROOT_DIR/scripts/uninstall-autostart.sh"
    ;;
  *)
    printf '[error] Unknown option: %s\n' "$1" >&2
    printf 'Usage: ./stop-complete-system.sh\n' >&2
    exit 1
    ;;
esac
