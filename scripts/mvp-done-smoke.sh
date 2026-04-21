#!/usr/bin/env bash
# MVP-DONE end-to-end acceptance (docs/MILESTONES.md MVP-DONE check 1):
# Skill + Plugin v3 both publish to one relay, Dashboard shows both,
# a cross-reference trace_references row exists between them.
#
# Also re-checks "zero legacy/ imports under src/" for completeness.
set -euo pipefail

ROOT="/tmp/agentxp-mvp-done"
rm -rf "$ROOT"
mkdir -p "$ROOT/workspace" "$ROOT/home"
export HOME="$ROOT/home"
export ROOT

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_BIN="$REPO/packages/skill/dist/cli.js"
SUPERNODE_ENTRY="$REPO/packages/supernode/dist/index.js"

PORT=13145
export PORT
PORT="$PORT" DB_PATH="$ROOT/relay.sqlite" node "$SUPERNODE_ENTRY" > "$ROOT/relay.log" 2>&1 &
RELAY_PID=$!
trap "kill $RELAY_PID 2>/dev/null || true" EXIT
sleep 1.5

RELAY_URL="http://localhost:$PORT"
export RELAY_URL

echo "=== 1. Skill publishes experience A ==="
node "$SKILL_BIN" init --dir "$ROOT/workspace" > /dev/null
cat > "$ROOT/workspace/.agentxp/config.json" <<JSON
{"relay_url":"$RELAY_URL","agent_id":"mvp-done"}
JSON
node "$REPO/scripts/m3-smoke-register-identity.mjs" > "$ROOT/register.out"
node "$SKILL_BIN" capture --dir "$ROOT/workspace" \
  --tier end-of-session \
  --what "MVP-DONE skill-side experience" \
  --tried "Seed a Skill experience that Plugin v3 will reference" \
  --outcome succeeded \
  --learned "Cross-SKU reference becomes a trace_references row" \
  --tag mvp-done --tag skill > /dev/null
node "$SKILL_BIN" reflect --dir "$ROOT/workspace" > "$ROOT/reflect.out"
SKILL_EVENT_ID="$(grep -o 'event_id=[0-9a-f]*' "$ROOT/reflect.out" | head -1 | cut -d= -f2)"
if [ -z "${SKILL_EVENT_ID:-}" ]; then
  echo "FAIL: skill did not publish an experience"
  cat "$ROOT/reflect.out"
  exit 1
fi
echo "skill_event_id=$SKILL_EVENT_ID"

echo "=== 2. Plugin v3 publishes experience B referencing A ==="
export SKILL_EVENT_ID
PLUGIN_OUT="$(node "$REPO/scripts/mvp-done-plugin-publish.mjs")"
echo "$PLUGIN_OUT"
PLUGIN_EVENT_ID="$(echo "$PLUGIN_OUT" | grep -o 'plugin_event_id=[0-9a-f]*' | cut -d= -f2)"
if [ -z "${PLUGIN_EVENT_ID:-}" ]; then
  echo "FAIL: plugin v3 did not publish"
  exit 1
fi
echo "plugin_event_id=$PLUGIN_EVENT_ID"

echo "=== 3. Dashboard lists both experiences ==="
DASH="$(curl -sS "$RELAY_URL/api/v1/dashboard/experiences?limit=50")"
echo "$DASH" | grep -q "$SKILL_EVENT_ID" || { echo "FAIL: dashboard missing skill event"; exit 1; }
echo "$DASH" | grep -q "$PLUGIN_EVENT_ID" || { echo "FAIL: dashboard missing plugin event"; exit 1; }
echo "ok: dashboard shows both events"

echo "=== 4. GET /experiences/\$PLUGIN/trace exposes reasoning_trace with 3 steps ==="
TRACE="$(curl -sS "$RELAY_URL/api/v1/experiences/$PLUGIN_EVENT_ID/trace")"
STEP_COUNT="$(echo "$TRACE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).reasoning_trace.steps.length))')"
if [ "$STEP_COUNT" != "3" ]; then
  echo "FAIL: expected 3 reasoning_trace steps, got $STEP_COUNT"
  echo "$TRACE"
  exit 1
fi
echo "ok: plugin trace has 3 steps (M4 check 1 reconfirmed end-to-end)"

echo "=== 5. trace_references row exists: plugin -> skill ==="
REFS="$(echo "$TRACE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).references)))')"
echo "refs=$REFS"
echo "$REFS" | grep -q "\"referenced_event_id\":\"$SKILL_EVENT_ID\"" \
  || { echo "FAIL: trace_references missing skill event id"; exit 1; }
echo "$REFS" | grep -q "\"source_experience_id\":\"$PLUGIN_EVENT_ID\"" \
  || { echo "FAIL: trace_references missing plugin source id"; exit 1; }
echo "$REFS" | grep -q "\"stale\":0" \
  || { echo "FAIL: reference marked stale — referent did not resolve"; exit 1; }
echo "ok: trace_references row exists (source=$PLUGIN_EVENT_ID → ref=$SKILL_EVENT_ID, stale=0)"

echo "=== 6. zero legacy/ imports under src/ ==="
if grep -rn --include="*.ts" --include="*.mjs" --include="*.js" "from ['\"].*legacy" "$REPO/src/" ; then
  echo "FAIL: src/ imports from legacy/"
  exit 1
fi
echo "ok: no src/ -> legacy/ imports"

echo "=== PASS ==="
