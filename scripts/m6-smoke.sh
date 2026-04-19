#!/usr/bin/env bash
# MILESTONES M6 check: feature parity with M3 against the same M2 relay.
# Acceptance cases per docs/spec/03-modules-product.md §4:
#   1. agentxp-hermes reflect publishes a valid signed experience.
#   2. Hermes against the same ~/.agentxp/identity as Skill produces
#      events attributable to the same operator_pubkey.
#   3. Canonical byte-count check is typed (exercised by pytest).
set -euo pipefail

ROOT="/tmp/agentxp-m6"
rm -rf "$ROOT"
mkdir -p "$ROOT/workspace" "$ROOT/home"
export HOME="$ROOT/home"
export ROOT

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_DIR="$REPO/src/packages/skill-hermes"
SKILL_BIN="$REPO/src/packages/skill/dist/cli.js"
SUPERNODE_ENTRY="$REPO/src/packages/supernode/dist/index.js"

PORT=13144
PORT="$PORT" DB_PATH="$ROOT/relay.sqlite" node "$SUPERNODE_ENTRY" > "$ROOT/relay.log" 2>&1 &
RELAY_PID=$!
trap "kill $RELAY_PID 2>/dev/null || true" EXIT
sleep 1.5

echo "=== 1. seed operator identity via Skill (init) ==="
node "$SKILL_BIN" init --dir "$ROOT/workspace" > /dev/null
cat > "$ROOT/workspace/.agentxp/config.json" <<JSON
{"relay_url":"http://localhost:$PORT","agent_id":"m6-hermes"}
JSON
RELAY_URL="http://localhost:$PORT" node "$REPO/scripts/m3-smoke-register-identity.mjs"
OPERATOR_PUBKEY="$(cat "$ROOT/home/.agentxp/identity/operator.json" | python3 -c 'import sys,json;print(json.load(sys.stdin)["publicKey"])')"
echo "operator=$OPERATOR_PUBKEY"

echo "=== 2. Hermes captures + reflects using the SAME identity dir ==="
cd "$HERMES_DIR"
uv run agentxp-hermes capture \
  --dir "$ROOT/workspace" \
  --tier end-of-session \
  --what "M6 hermes smoke" \
  --tried "Capture + publish from the Python SKU against the same relay" \
  --outcome succeeded \
  --learned "Cross-SKU operator identity is byte-identical on disk" \
  --tag m6 --tag hermes
uv run agentxp-hermes reflect --dir "$ROOT/workspace" | tee "$ROOT/reflect.out"
EVENT_ID="$(grep -o 'event_id=[0-9a-f]*' "$ROOT/reflect.out" | head -1 | cut -d= -f2)"
cd "$REPO"

echo "=== 3. relay stored the event + attributes it to the operator ==="
curl -sS "http://localhost:$PORT/api/v1/events/$EVENT_ID" > "$ROOT/event.json"
STORED_OP="$(python3 -c 'import sys,json;print(json.load(sys.stdin)["event"]["operator_pubkey"])' < "$ROOT/event.json")"
if [ "$STORED_OP" != "$OPERATOR_PUBKEY" ]; then
  echo "FAIL: stored operator_pubkey $STORED_OP != expected $OPERATOR_PUBKEY"
  exit 1
fi
echo "ok: relay attributes the Hermes-signed event to operator=$OPERATOR_PUBKEY"

echo "=== 4. dashboard lists the Hermes event ==="
curl -sS "http://localhost:$PORT/api/v1/dashboard/experiences" | grep -q "$EVENT_ID"
echo "ok: dashboard lists the Hermes-published event"

echo "=== PASS ==="
