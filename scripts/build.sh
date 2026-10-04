#!/bin/bash
# Build the project for production

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Type checking..."
npm run typecheck

echo "Building graphic-example..."
rm -rf dist
npm run build

echo "Build complete! Output in dist/"
echo "  dist/index.html"
echo "  dist/combined-demo.html"
echo "  dist/vertex-demo.html"
echo "  dist/fragment-demo.html"
echo "  dist/donut-uv-demo.html"
echo "  dist/donut-procedural-demo.html"
echo "To deploy: ./scripts/deploy.sh [port]"
