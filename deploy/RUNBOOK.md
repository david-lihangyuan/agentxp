# MVP v0.1 — VPS Cutover Runbook

**Target:** `root@154.12.191.239` (agentxp.io / relay.agentxp.io)
**Strategy:** Clean-slate, blue/green on PM2 + nginx.
**Rollback:** nginx backup + `pm2 start agentxp` restores legacy in < 60s.

Legacy in-place: PM2 app `agentxp` (id 17), cwd `/opt/agentxp/supernode`,
port 3141, DB `/opt/agentxp/data/agentxp.db` (712 events as of 2026-04-19).

New in parallel: PM2 app `agentxp-v0.1`, cwd `/opt/agentxp-v0.1`,
port 3142, DB `/opt/agentxp/data-v0.1/agentxp.db` (empty, clean-slate).

---

## Pre-flight (run locally before any VPS step)

```bash
cd /Users/davidli/agentxp/agentxp
git status                              # must be clean
git log --oneline -1                    # confirm tip is on feat/v0.1-impl
npx vitest run                          # 85/85 must pass
bash scripts/mvp-done-smoke.sh          # 6/6 must pass
```

---

## Step 1 — Archive legacy DB (2 artefacts)

```bash
ssh root@154.12.191.239
mkdir -p /opt/backups/agentxp-legacy-2026-04-19
cd /opt/backups/agentxp-legacy-2026-04-19

# 1a. full binary snapshot (online, WAL-safe)
sqlite3 /opt/agentxp/data/agentxp.db \
  ".backup /opt/backups/agentxp-legacy-2026-04-19/agentxp.db.snapshot"
sha256sum agentxp.db.snapshot > agentxp.db.snapshot.sha256
ls -lh agentxp.db.snapshot           # should be ~35 MB

# 1b. JSONL export of core tables (events / identities / relations)
# requires the new repo checked out somewhere with better-sqlite3
# installed.  Simplest: run from the rsync'd copy once Step 3 lands.
# (deferred to Step 4a — see below)
```

---

## Step 2 — Provision new layout

```bash
ssh root@154.12.191.239
mkdir -p /opt/agentxp-v0.1
mkdir -p /opt/agentxp/data-v0.1
chown root:root /opt/agentxp-v0.1 /opt/agentxp/data-v0.1
```

---

## Step 3 — Rsync repo to VPS

Locally, from repo root:

```bash
rsync -avz --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='legacy/' \
  --exclude='**/dist/' \
  --exclude='*.db' \
  --exclude='*.db-wal' \
  --exclude='*.db-shm' \
  --exclude='/agents/' \
  ./ root@154.12.191.239:/opt/agentxp-v0.1/
```

---

## Step 4 — Build on VPS

```bash
ssh root@154.12.191.239
cd /opt/agentxp-v0.1
bash deploy/build-on-vps.sh            # ~60s on first run
```

### 4a. JSONL export (now that better-sqlite3 is installed)

```bash
node /opt/agentxp-v0.1/scripts/export-legacy-db-to-jsonl.mjs \
  --db  /opt/agentxp/data/agentxp.db \
  --out /opt/backups/agentxp-legacy-2026-04-19/
ls /opt/backups/agentxp-legacy-2026-04-19/
# expected: events-*.jsonl identities-*.jsonl experience-relations-*.jsonl
#           SUMMARY-*.json  agentxp.db.snapshot  agentxp.db.snapshot.sha256
```

---

## Step 5 — Start new relay on :3142

```bash
ssh root@154.12.191.239
cd /opt/agentxp-v0.1
pm2 start deploy/ecosystem.config.cjs
pm2 logs agentxp-v0.1 --lines 20 --nostream
ss -tlnp | grep 3142                   # must show node listening
curl -s http://127.0.0.1:3142/health   # must return 200
```

---

## Step 6 — Deployment smoke test against :3142

`scripts/mvp-done-smoke.sh` spawns its own relay on port 13145 for code
correctness, so it cannot validate a remote target. For the VPS we do
targeted probes that exercise the live relay:

```bash
ssh root@154.12.191.239 'bash -s' <<'PROBE'
set -eu
URL=http://127.0.0.1:3142

echo "--- /health"
curl -sS -f "$URL/health" ; echo

echo "--- /api/v1/dashboard/experiences (expect empty array)"
curl -sS -f "$URL/api/v1/dashboard/experiences?limit=1"

echo "--- /api/v1/pulse"
curl -sS -f "$URL/api/v1/pulse?limit=1"

echo "--- malformed POST /api/v1/events (expect 400 malformed_event)"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST -H 'Content-Type: application/json' \
  --data '{"event":null}' "$URL/api/v1/events"

echo "--- /dashboard HTML (expect 200)"
curl -s -o /dev/null -w "%{http_code}\n" "$URL/dashboard"
PROBE
```

Expected:
- `/health` → `{"status":"ok","version":"0.1.0"}`
- dashboard/pulse → empty arrays (clean-slate)
- malformed events → `400`
- dashboard HTML → `200`

If any check fails → STOP, diagnose, do not flip nginx.

---

## Step 7 — Flip nginx 3141 → 3142

```bash
ssh root@154.12.191.239
cp /etc/nginx/sites-enabled/agentxp /etc/nginx/sites-enabled/agentxp.bak-2026-04-19
cp /opt/agentxp-v0.1/deploy/nginx/agentxp.conf /etc/nginx/sites-enabled/agentxp
nginx -t                               # must print "syntax is ok"
systemctl reload nginx
```

Verify:
```bash
curl -sI https://relay.agentxp.io/health | head -3
curl -s  https://relay.agentxp.io/health
```

---

## Step 8 — Retire legacy

After 15 min of clean traffic on :3142:

```bash
ssh root@154.12.191.239
pm2 stop   agentxp                     # id 17, still on disk
pm2 save
```

**Do NOT `pm2 delete` yet.** Keep the legacy app stopped-but-present for
one week so rollback is a single `pm2 start 17`.

---

## Rollback (any time before Step 8 finalises)

```bash
ssh root@154.12.191.239
cp /etc/nginx/sites-enabled/agentxp.bak-2026-04-19 /etc/nginx/sites-enabled/agentxp
nginx -t && systemctl reload nginx
pm2 restart agentxp                    # if it was stopped
pm2 stop    agentxp-v0.1               # optional, stops the new one
```

Legacy DB was never touched (archive is read-only `sqlite3 .backup`), so
no data state to restore.

---

## Post-cutover checklist

- [ ] `https://relay.agentxp.io/health` returns new-version JSON
- [ ] `scripts/mvp-done-smoke.sh` passes against the public URL
- [ ] Archive manifest committed to ops log (SUMMARY.json SHA256 pinned)
- [ ] PR `feat/v0.1-impl → main` merged and tag `mvp-v0.1.0` promoted
- [ ] `pm2 save` executed so PM2 comes back the same way on reboot
