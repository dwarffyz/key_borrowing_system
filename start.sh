#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/public"
ENV_FILE="$APP_DIR/.env"

log() { printf '\n[start] %s\n' "$*"; }
warn() { printf '\n[warning] %s\n' "$*" >&2; }
die() { printf '\n[error] %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[[ -f "$ENV_FILE" ]] || die "Missing public/.env. Run ./install.sh first."
have node || die "Node.js was not found. Run ./install.sh first."

if have systemctl && systemctl list-unit-files | grep -q '^mongod\.service'; then
  if ! systemctl is-active --quiet mongod; then
    warn "MongoDB service is not running. Trying to start it with sudo..."
    sudo systemctl start mongod || warn "Could not start mongod. Check MongoDB or use MongoDB Atlas in public/.env."
  fi
elif have mongod && ! pgrep -x mongod >/dev/null 2>&1; then
  warn "mongod is installed but not running. Start MongoDB before logging in if the app cannot connect."
fi

log "Starting the web app..."
log "Local URL: http://localhost:${PORT:-3000}"
(cd "$ROOT_DIR" && npm start)

