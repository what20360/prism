#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ ! -f node_modules/ws/package.json ]; then npm ci --omit=dev; fi
exec node dist-server/server.mjs
