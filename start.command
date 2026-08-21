#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.13 or newer is required."
  exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22.13 or newer is required; found $(node --version)."
  exit 1
fi

cd "$APP_DIR"
echo "Starting SMARTwinFA Web at http://localhost:3000"
echo "Press Control-C to stop."
npm run dev
