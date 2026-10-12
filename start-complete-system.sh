#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Unix equivalent of start-complete-system.ps1. The local app starts in the
# foreground; Docker MongoDB is started by start.sh when configured.
exec /usr/bin/env bash "$ROOT_DIR/start.sh" "$@"
