#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n[uninstall] %s\n' "$*"; }
warn() { printf '\n[warning] %s\n' "$*" >&2; }

log "Removing installed npm packages and local runtime logs..."
rm -rf "$ROOT_DIR/node_modules" "$ROOT_DIR/public/node_modules" "$ROOT_DIR/.tools"

warn "public/.env and MongoDB data were kept for safety."
warn "Delete public/.env manually only after backing up credentials."
log "Uninstall cleanup complete."

