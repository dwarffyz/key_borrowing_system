#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
CONTAINER_NAME="key-borrowing-mongodb"
TIMEOUT_SECONDS="${1:-60}"

die() { printf '\n[error] %s\n' "$*" >&2; exit 1; }

[[ -f "$COMPOSE_FILE" ]] || die "Missing Docker Compose file: $COMPOSE_FILE"
command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install and start Docker Desktop (or Docker Engine)."
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker, then try again."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required. Update Docker, then try again."

printf '\n[mongodb] Starting MongoDB Docker container...\n'
docker compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE" up --detach mongodb

deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [[ "$health" == "healthy" ]]; then
    printf '[mongodb] MongoDB is healthy at mongodb://localhost:27017\n'
    exit 0
  fi
  [[ "$health" != "unhealthy" && "$health" != "exited" && "$health" != "dead" ]] || die "MongoDB container is $health. Run: docker compose logs mongodb"
  sleep 2
done

die "MongoDB did not become healthy within ${TIMEOUT_SECONDS} seconds. Run: docker compose logs mongodb"
