#!/usr/bin/env bash
# MILESTONES M3 Check 2 evidence: full round-trip of agentxp init /
# capture / reflect against a real relay boot.
set -euo pipefail

ROOT="/tmp/agentxp-m3"
rm -rf "$ROOT"
mkdir -p "$ROOT/workspace" "$ROOT/home"
export HOME="$ROOT/home"
export ROOT

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_BIN="$REPO/packages/skill/dist/cli.js"
SUPERNODE_ENTRY="$REPO/packages/supernode/dist/index.js"

PORT=13141 DB_PATH="$ROOT/relay.sqlite" node "$SUPERNODE_ENTRY" > "$ROOT/relay.log" 2>&1 &
RELAY_PID=$!
trap "kill $RELAY_PID 2>/dev/null || true" EXIT
sleep 1.5

echo "=== 1. agentxp init ==="
node "$SKILL_BIN" init --dir "$ROOT/workspace"
test -f "$ROOT/workspace/SKILL.md"
test -f "$ROOT/workspace/.agentxp/config.json"
test -f "$ROOT/home/.agentxp/identity/operator.json"

cat > "$ROOT/workspace/.agentxp/config.json" <<JSON
{"relay_url":"http://localhost:13141","agent_id":"m3-smoke"}
JSON

echo "=== 2. register operator + delegate agent ==="
node "$REPO/scripts/m3-smoke-register-identity.mjs"

echo "=== 3. agentxp capture (tier end-of-session) ==="
node "$SKILL_BIN" capture --dir "$ROOT/workspace" \
  --tier end-of-session \
  --what "Verified M3 smoke" \
  --tried "Invoked agentxp reflect against a local relay" \
  --outcome succeeded \
  --learned "The Skill CLI round-trips through the M2 relay" \
  --tag m3 --tag smoke

echo "=== 4. agentxp reflect ==="
node "$SKILL_BIN" reflect --dir "$ROOT/workspace"

echo "=== 5. GET /search?q=smoke ==="
BODY="$(curl -sS "http://localhost:13141/api/v1/search?q=smoke")"
echo "$BODY"
echo "$BODY" | grep -q '"results"' || { echo "FAIL: no results field"; exit 1; }
echo "$BODY" | grep -q 'Verified M3 smoke' || { echo "FAIL: published event not in search"; exit 1; }

echo "=== PASS ==="
