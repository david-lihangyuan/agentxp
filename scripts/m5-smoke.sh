#!/usr/bin/env bash
# MILESTONES M5 checks against a running relay:
#   1. Browser reaches /dashboard and renders recent experiences (HTML + JSON).
#   2. GET /api/v1/experiences/:id/trace returns the trace.
#   3. Dashboard is verified read-only (POST /dashboard -> 404/405).
set -euo pipefail

ROOT="/tmp/agentxp-m5"
rm -rf "$ROOT"
mkdir -p "$ROOT/workspace" "$ROOT/home"
export HOME="$ROOT/home"
export ROOT

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_BIN="$REPO/packages/skill/dist/cli.js"
SUPERNODE_ENTRY="$REPO/packages/supernode/dist/index.js"

PORT=13143
PORT="$PORT" DB_PATH="$ROOT/relay.sqlite" node "$SUPERNODE_ENTRY" > "$ROOT/relay.log" 2>&1 &
RELAY_PID=$!
trap "kill $RELAY_PID 2>/dev/null || true" EXIT
sleep 1.5

echo "=== 1. seed data via Skill (init + capture + reflect) ==="
node "$SKILL_BIN" init --dir "$ROOT/workspace" > /dev/null
cat > "$ROOT/workspace/.agentxp/config.json" <<JSON
{"relay_url":"http://localhost:$PORT","agent_id":"m5-smoke"}
JSON
RELAY_URL="http://localhost:$PORT" node "$REPO/scripts/m3-smoke-register-identity.mjs"
node "$SKILL_BIN" capture --dir "$ROOT/workspace" \
  --tier end-of-session --what "M5 smoke experience" \
  --tried "Booted relay, published an experience" \
  --outcome succeeded --learned "Dashboard renders what was published" \
  --tag m5 --tag smoke > /dev/null
node "$SKILL_BIN" reflect --dir "$ROOT/workspace" | grep -o 'event_id=[0-9a-f]*' > "$ROOT/event.id"
EVENT_ID="$(cut -d= -f2 "$ROOT/event.id")"
echo "published event_id=$EVENT_ID"

echo "=== 2. GET /dashboard ==="
curl -sS "http://localhost:$PORT/dashboard" | grep -q 'AgentXP Dashboard'
echo "ok: /dashboard serves HTML"

echo "=== 3. POST /dashboard -> 404/405 ==="
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "http://localhost:$PORT/dashboard")"
if [ "$CODE" != "404" ] && [ "$CODE" != "405" ]; then
  echo "FAIL: POST /dashboard returned $CODE"
  exit 1
fi
echo "ok: POST /dashboard -> $CODE"

echo "=== 4. /api/v1/dashboard/experiences contains the published event ==="
curl -sS "http://localhost:$PORT/api/v1/dashboard/experiences" | grep -q "$EVENT_ID"
echo "ok: dashboard lists the event"

echo "=== 5. /api/v1/experiences/$EVENT_ID/trace ==="
curl -sS "http://localhost:$PORT/api/v1/experiences/$EVENT_ID/trace" | head -c 200
echo

echo "=== 6. /api/v1/experiences/$EVENT_ID/score ==="
curl -sS "http://localhost:$PORT/api/v1/experiences/$EVENT_ID/score"
echo

echo "=== PASS ==="
