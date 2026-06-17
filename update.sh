#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n[update] %s\n' "$*"; }

if [[ -d "$ROOT_DIR/.git" ]] && command -v git >/dev/null 2>&1; then
  log "Pulling latest code..."
  git -C "$ROOT_DIR" pull --ff-only
fi

log "Refreshing npm packages..."
(cd "$ROOT_DIR" && npm install --no-fund --no-audit)
(cd "$ROOT_DIR/public" && npm install --no-fund --no-audit)

log "Update complete."

