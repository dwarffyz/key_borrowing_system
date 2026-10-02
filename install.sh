#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/public"
ENV_FILE="$APP_DIR/.env"
ENV_EXAMPLE="$APP_DIR/.env.example"

log() { printf '\n[install] %s\n' "$*"; }
warn() { printf '\n[warning] %s\n' "$*" >&2; }
die() { printf '\n[error] %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

install_system_packages() {
  if [[ "${SKIP_SYSTEM_PACKAGES:-0}" == "1" ]]; then
    warn "Skipping system package installation because SKIP_SYSTEM_PACKAGES=1."
    return
  fi

  if have apt-get; then
    log "Installing base packages with apt..."
    sudo apt-get update
    sudo apt-get install -y curl git ca-certificates nodejs npm python3 python3-pip python3-venv build-essential
  elif have pacman; then
    log "Installing base packages with pacman..."
    sudo pacman -Sy --needed --noconfirm curl git nodejs npm python python-pip base-devel
  elif have dnf; then
    log "Installing base packages with dnf..."
    sudo dnf install -y curl git nodejs npm python3 python3-pip gcc gcc-c++ make
  elif have brew; then
    log "Installing base packages with Homebrew..."
    brew install node python git || true
  else
    warn "No supported package manager found. Install Node.js 16+, npm, Git, and Python 3 manually."
  fi
}

ensure_node() {
  have node || die "Node.js was not found. Install Node.js 16+ and run ./install.sh again."
  have npm || die "npm was not found. Install npm and run ./install.sh again."
  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  [[ "$major" -ge 16 ]] || die "Node.js 16+ is required. Current version: $(node -v)"
  log "Node.js ready: $(node -v)"
}

ensure_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "$ENV_EXAMPLE" ]] || die "Missing $ENV_EXAMPLE"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    warn "Created public/.env from public/.env.example. Update secrets before production use."
  else
    log "public/.env already exists."
  fi
}

install_npm_packages() {
  log "Installing root npm packages..."
  (cd "$ROOT_DIR" && npm install --no-fund --no-audit)
  log "Installing app npm packages..."
  (cd "$APP_DIR" && npm install --no-fund --no-audit)
}

check_mongodb() {
  if have docker && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    "$ROOT_DIR/scripts/start-mongodb.sh"
  elif have mongod; then
    warn "Docker is unavailable; using an existing local MongoDB installation instead."
  else
    warn "Docker is unavailable. Install and start Docker (recommended), or set MONGODB_URI to MongoDB Atlas before starting."
  fi
}

main() {
  log "Key Borrowing System cross-platform installer"
  install_system_packages
  ensure_node
  ensure_env
  install_npm_packages
  check_mongodb
  log "Install complete. Start with: ./start.sh"
}

main "$@"
