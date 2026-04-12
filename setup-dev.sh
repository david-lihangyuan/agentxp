#!/usr/bin/env bash
# setup-dev.sh — Bootstrap local AgentXP development environment
# Usage: bash setup-dev.sh
set -euo pipefail

RELAY_PORT="${RELAY_PORT:-3000}"
RELAY_DB="${RELAY_DB:-data/agentxp-dev.db}"

echo "==> AgentXP local dev setup"
echo ""

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found. Install Node.js >= 20 first."
  exit 1
fi
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js >= 20 required (found $NODE_MAJOR)"
  exit 1
fi
echo "[ok] Node.js $(node --version)"

# 2. Install all dependencies
echo ""
echo "==> Installing dependencies..."
npm install --frozen-lockfile

# 3. Run migrations + seed test data
echo ""
echo "==> Running DB migrations + seeding test data..."
mkdir -p data
node --import tsx/esm scripts/seed-dev.ts

# 4. Type-check
echo ""
echo "==> Type-checking..."
npx tsc --noEmit -p packages/protocol/tsconfig.json
npx tsc --noEmit -p packages/skill/tsconfig.json

# 5. Run tests
echo ""
echo "==> Running tests..."
npm run test 2>&1 | tail -8

echo ""
echo "==> Dev environment ready!"
echo ""
echo "    Start relay:   cd supernode && RELAY_PORT=${RELAY_PORT} DB_PATH=${RELAY_DB} node --import tsx/esm src/index.ts"
echo "    Dashboard:     http://localhost:${RELAY_PORT}/dashboard"
echo "    API:           http://localhost:${RELAY_PORT}/api/v1/health"
echo ""
echo "    Run all tests: npm run test"
echo "    Skill tests:   cd packages/skill && npx vitest run"
echo "    Relay tests:   cd supernode && npx vitest run"
