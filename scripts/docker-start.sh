#!/bin/bash
# Build and start the app in Docker (usage: ./scripts/docker-start.sh [port]).

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${1:-4173}"
CONTAINER_NAME="graphic-example-app"

remove_containers() {
  local description="$1"
  shift

  local -a ids=()
  local id
  while IFS= read -r id; do
    [[ -n "$id" ]] && ids+=("$id")
  done < <(docker ps -aq "$@")

  if ((${#ids[@]} > 0)); then
    echo "Removing ${description}..."
    docker rm -f "${ids[@]}"
  fi
}

# Free the requested host port from existing Docker containers, then remove
# any stopped or differently configured instance of this app's container.
remove_containers "container(s) publishing port ${PORT}" --filter "publish=${PORT}"
remove_containers "existing ${CONTAINER_NAME} container" --filter "name=^/${CONTAINER_NAME}$"

# Never kill an unrelated host process; report it so the user can stop it.
if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
  echo "Port ${PORT} is still in use by a non-Docker process." >&2
  echo "Stop that process, then run this script again." >&2
  exit 1
fi

PORT="$PORT" docker compose up -d --build

echo "Serving Docker container at https://localhost:${PORT} (self-signed certificate)"
PORT="$PORT" docker compose ps
