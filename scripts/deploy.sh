#!/bin/bash
# Deploy the built application locally (usage: ./scripts/deploy.sh [port])

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${1:-4173}"

# Always rebuild so dist/ matches the current source
./scripts/build.sh

echo "Serving dist/ at http://localhost:${PORT}"
echo "  http://localhost:${PORT}/vertex-demo.html"
echo "  http://localhost:${PORT}/fragment-demo.html"
echo "Press Ctrl+C to stop"
npx vite preview --host --port "${PORT}" --strictPort
