#!/usr/bin/env bash
# Build @agentxp/protocol + @agentxp/supernode on the VPS.
# Idempotent: safe to re-run after every rsync.
#
# Expected layout:
#   /opt/agentxp-v0.1/             <- this script's cwd
#     package.json (workspaces root)
#     src/packages/protocol/
#     src/packages/supernode/
set -euo pipefail

ROOT="/opt/agentxp-v0.1"
cd "$ROOT"

echo "==> node $(node --version)  npm $(npm --version)"
echo "==> installing workspace dependencies"
npm ci

echo "==> building @agentxp/protocol"
npm run -w @agentxp/protocol build

echo "==> building @agentxp/supernode"
npm run -w @agentxp/supernode build

echo "==> smoke: dist artefacts present"
test -f src/packages/protocol/dist/index.js
test -f src/packages/supernode/dist/index.js

echo "==> OK"
