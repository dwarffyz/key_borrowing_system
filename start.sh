#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/public"
ENV_FILE="$APP_DIR/.env"

log() { printf '\n[start] %s\n' "$*"; }
warn() { printf '\n[warning] %s\n' "$*" >&2; }
die() { printf '\n[error] %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

get_env_mongodb_uri() {
  local configured_uri
  configured_uri="$(sed -nE 's/^[[:space:]]*MONGODB_URI[[:space:]]*=[[:space:]]*(.*)$/\1/p' "$ENV_FILE" | head -n 1)"
  printf '%s' "${MONGODB_URI:-${configured_uri:-mongodb://localhost:27017/key_borrowing_system}}"
}

is_local_mongodb_uri() {
  local uri
  uri="$(get_env_mongodb_uri)"
  [[ "$uri" =~ ^mongodb://(localhost|127\.0\.0\.1)(:|/) ]]
}

[[ -f "$ENV_FILE" ]] || die "Missing public/.env. Run ./install.sh first."
have node || die "Node.js was not found. Run ./install.sh first."

if is_local_mongodb_uri && have docker && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  "$ROOT_DIR/scripts/start-mongodb.sh"
elif is_local_mongodb_uri && have systemctl && systemctl list-unit-files | grep -q '^mongod\.service'; then
  if ! systemctl is-active --quiet mongod; then
    warn "MongoDB service is not running. Trying to start it with sudo..."
    sudo systemctl start mongod || warn "Could not start mongod. Start Docker, MongoDB, or use MongoDB Atlas in public/.env."
  fi
elif is_local_mongodb_uri && have mongod && ! pgrep -x mongod >/dev/null 2>&1; then
  warn "MongoDB is not running. Start Docker, MongoDB, or use MongoDB Atlas in public/.env."
fi

log "Starting the web app..."
log "Local URL: http://localhost:${PORT:-3000}"
(cd "$ROOT_DIR" && npm start)
