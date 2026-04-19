# Feedback Loop Rollout Runbook — 2026-04-18

Ship the end-to-end feedback loop (search-hit + verification events + pulse
state transitions + plugin-v3 closed loop) to production.

## Pre-flight

- VPS: `root@154.12.191.239` (agentxp pm2 id 17)
- Relay URL: `https://relay.agentxp.io`
- DB path: `/opt/agentxp/data/agentxp.db` (33 MB, backup at
  `agentxp.db.backup-20260417-145138`)
- Deploy dir: `/opt/agentxp/supernode/`
- VPS is **not** a git repo; deployment is by rsync of the `supernode/`
  tree from this monorepo.

Confirm state before starting:

```bash
ssh root@154.12.191.239 "
  pm2 list | grep agentxp
  sqlite3 /opt/agentxp/data/agentxp.db 'SELECT COUNT(*) FROM experiences; SELECT COUNT(*) FROM relay_nodes; SELECT COUNT(*) FROM pulse_events;'
  pm2 env 17 | grep -E 'RELAY_TRUSTED_NODES|DATABASE_PATH|PORT'
"
```

Expect at this moment (verified 2026-04-18):
- `agentxp` online, uptime 20h
- `experiences = 403`, `relay_nodes = 0`, `pulse_events = 0`
- `RELAY_TRUSTED_NODES` unset — safe because `relay_nodes` is empty

## Branches to merge (strict order)

Verified locally by merge rehearsal: zero conflicts, 1403 vitest tests
passing, three packages tsc-clean after all seven branches applied.

1. `chore/cold-start-rebrand` — docs only
2. `chore/plugin-v3-remove-telegram-and-tag` — plugin cleanup
3. `chore/plugin-v3-workspace-integration` — fixes typecheck for later branches
4. `feat/node-trust-whitelist` — relay sync scope gate
5. `fix/verification-loop` — relay-side search + verification hooks
6. `fix/pulse-highlights-event-id` — plugin/relay pulse shape alignment
7. `feat/plugin-v3-search-and-verification` — plugin closes the loop
8. `chore/smoke-test-feedback-loop` — deploy-time verification script

**Merge strategy:** create merge commits (not squash). The rehearsal used
merge commits; squash was not tested and `feat/plugin-v3-search-and-verification`
is stacked on `fix/pulse-highlights-event-id`, so squash would force a
rebase on #7.

## Deploy

After all PRs are in `main`, from your workstation:

```bash
git checkout main && git pull
# Build local sanity check
npm run typecheck && npx vitest run

# Rsync supernode tree (excluding dev/test artefacts)
rsync -avz --delete \
  --exclude='node_modules' --exclude='tests' --exclude='*.db*' \
  supernode/ root@154.12.191.239:/opt/agentxp/supernode/
rsync -avz packages/ root@154.12.191.239:/opt/agentxp/packages/

# Install any new deps and restart
ssh root@154.12.191.239 "
  cd /opt/agentxp && npm install --production
  pm2 restart 17 --update-env
  sleep 3 && curl -s https://relay.agentxp.io/health
"
```

## Verify

Run the smoke test from your workstation against prod:

```bash
RELAY_URL=https://relay.agentxp.io npx tsx scripts/smoke-test-feedback-loop.ts
```

Expect 5/5 ✓. Failures map directly to missing pieces:

| Failed step | Likely cause |
|---|---|
| `publish` | relay crashed / 500; check `pm2 logs agentxp` |
| `search hits target` | embedding queue stalled or OPENAI_API_KEY wrong |
| `pulse shows discovery` | `fix/verification-loop` (search → pulse) not deployed |
| `verify accepted` | verification schema missing; `fix/verification-loop` not deployed |
| `pulse shows verified` | scoring → pulse hook not wired; same branch |

After deploy, expect in DB:

```bash
ssh root@154.12.191.239 "sqlite3 /opt/agentxp/data/agentxp.db '
  SELECT type, COUNT(*) FROM pulse_events GROUP BY type;
  SELECT COUNT(*) FROM events WHERE kind = \"io.agentxp.verification\";
'"
```

## Optional post-deploy: trust whitelist

Only needed if/when other relays register against this supernode. Current
`relay_nodes` is empty so no action is required at rollout time.

To grant `full` sync scope to a specific relay pubkey later:

```bash
ssh root@154.12.191.239 "
  pm2 set agentxp:RELAY_TRUSTED_NODES 'hex_pubkey_1,hex_pubkey_2'
  pm2 restart 17 --update-env
"
```

After the env var is set, the trusted relay's **next** registration
re-runs the UPSERT and flips `verified=1`. Existing rows are not rewritten
until their next register call.

## Rollback

If the smoke test fails in a way that threatens the existing 403
experiences or causes 5xx on ingest:

```bash
ssh root@154.12.191.239 "
  pm2 stop 17
  cp /opt/agentxp/data/agentxp.db /opt/agentxp/data/agentxp.db.broken-$(date +%Y%m%d-%H%M)
  cp /opt/agentxp/data/agentxp.db.backup-20260417-145138 /opt/agentxp/data/agentxp.db
"
```

Then re-rsync the previous known-good `supernode/` tree. Keep a tarball
of the current prod tree before the first deploy in case you need to
restore the code side too:

```bash
ssh root@154.12.191.239 "
  tar -czf /root/supernode-pre-feedback-loop.tgz -C /opt/agentxp supernode
"
```

## Known limitations deferred to follow-up

- `pullPulseEvents` does not pass `since` — every tick pulls full history
  for the operator. Functionally correct (no-downgrade guard + event_id
  match), but a perf concern at scale.
- Plugin-v3 is workspace-local; no npm publish, no bundled openclaw
  install path. Relay endpoints go live at this rollout but no agent
  client consumes them until plugin distribution lands.
- `verification_log` and `search_log` tables are plugin-side only;
  deduplication is per-install, not global.
