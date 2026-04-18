#!/usr/bin/env bash
# setup-dev.sh — One-command dev bootstrap for AgentXP
#
# Steps:
#   1. npm install in all packages (monorepo workspaces)
#   2. Run DB migrations (supernode/migrations/)
#   3. Seed test data
#   4. Start the relay (supernode) in the background
#
# Usage:
#   ./scripts/setup-dev.sh [--no-relay] [--no-seed]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[setup-dev]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup-dev]${NC} $*"; }
error() { echo -e "${RED}[setup-dev]${NC} $*" >&2; exit 1; }

# ── Flags ─────────────────────────────────────────────────────────────────────
START_RELAY=true
RUN_SEED=true
for arg in "$@"; do
  case $arg in
    --no-relay) START_RELAY=false ;;
    --no-seed)  RUN_SEED=false ;;
    *) warn "Unknown flag: $arg" ;;
  esac
done

# ── Step 1: npm install ───────────────────────────────────────────────────────
info "Step 1/4: Installing dependencies (npm install --workspaces)..."
cd "$REPO_ROOT"
npm install
info "✓ npm install complete"

# ── Step 2: DB migrations ─────────────────────────────────────────────────────
info "Step 2/4: Running DB migrations..."
MIGRATIONS_DIR="$REPO_ROOT/supernode/migrations"
DB_FILE="${AGENTXP_DB:-$REPO_ROOT/supernode/dev.db}"

if command -v node >/dev/null 2>&1; then
  if [ -d "$MIGRATIONS_DIR" ]; then
    # Run each .sql migration file in order
    for migration in "$MIGRATIONS_DIR"/*.sql; do
      [ -f "$migration" ] || continue
      info "  Applying migration: $(basename "$migration")"
      node -e "
        const Database = require('better-sqlite3');
        const fs = require('fs');
        const db = new Database('$DB_FILE');
        db.exec(fs.readFileSync('$migration', 'utf8'));
        db.close();
        console.log('  ✓ Applied');
      " 2>/dev/null || warn "  Migration $(basename "$migration") skipped (may already be applied)"
    done
  else
    warn "No migrations directory found at $MIGRATIONS_DIR — skipping migrations"
  fi
else
  error "node is required to run migrations"
fi
info "✓ DB migrations complete"

# ── Step 3: Seed test data ────────────────────────────────────────────────────
if $RUN_SEED; then
  info "Step 3/4: Seeding test data..."
  SEED_SCRIPT="$REPO_ROOT/supernode/scripts/seed.ts"
  SEED_JS="$REPO_ROOT/supernode/scripts/seed.js"

  if [ -f "$SEED_SCRIPT" ]; then
    npx tsx "$SEED_SCRIPT" && info "✓ Seed complete" || warn "Seed returned non-zero (non-fatal)"
  elif [ -f "$SEED_JS" ]; then
    node "$SEED_JS" && info "✓ Seed complete" || warn "Seed returned non-zero (non-fatal)"
  else
    warn "No seed script found — skipping seed"
  fi
else
  info "Step 3/4: Skipping seed (--no-seed)"
fi

# ── Step 4: Start relay ───────────────────────────────────────────────────────
if $START_RELAY; then
  info "Step 4/4: Starting relay (supernode) in background..."
  SUPERNODE_DIR="$REPO_ROOT/supernode"

  if [ -f "$SUPERNODE_DIR/package.json" ]; then
    cd "$SUPERNODE_DIR"
    # Start in background, write PID for later teardown
    npm run dev > "$REPO_ROOT/supernode.log" 2>&1 &
    RELAY_PID=$!
    echo "$RELAY_PID" > "$REPO_ROOT/.relay.pid"
    info "✓ Relay started (PID=$RELAY_PID). Logs: supernode.log"
    info "  Stop relay with: kill \$(cat .relay.pid)"
  else
    warn "No supernode/package.json found — skipping relay start"
  fi
else
  info "Step 4/4: Skipping relay start (--no-relay)"
fi

info ""
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "  AgentXP dev environment ready! 🦞"
info "  Run tests: npm test"
info "  Relay logs: tail -f supernode.log"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
