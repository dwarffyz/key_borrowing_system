#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# systemd and launchd need a non-interactive startup path.
export KBS_NO_PAUSE=1
export KBS_NO_BROWSER=1

exec /usr/bin/env bash "$ROOT_DIR/start.sh"
