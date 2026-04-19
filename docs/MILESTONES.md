# AgentXP MVP v0.1 — Milestones

Status signal for each milestone: **NOT STARTED / IN PROGRESS / DONE**.
A milestone is `DONE` iff every "Check" under it passes. The project
lead may ask for a demo of any Check at any time.

Implementation proceeds on branch `feat/v0.1-impl` (from
`chore/bootstrap-spec`). SPEC authority is `docs/spec/`. Layout is
ADR-002. Rules are `.augment/rules/project.md`.

---

## M0 — Workspace scaffolding

Scope: configure the monorepo shell. No product logic.

Artefacts:
- Root `package.json` with `"workspaces": ["src/packages/*"]`
- `src/packages/` directory exists (may be empty)
- `tsconfig.json`, `vitest.config.ts`, lint rule blocking imports
  from `legacy/`

Checks:
- [x] `bun install` (or `npm install`) completes with no errors
- [x] `bun test` (or `npm test`) runs with 0 tests, exit 0
- [x] `grep -r "from ['\"].*legacy" src/` returns nothing

Expected duration: half a day.

---

## M1 — Protocol core (`@agentxp/protocol`)

Scope: SPEC module #1 + kind-registry integration (`kind-registry/`).
Reference: `docs/spec/03-modules-platform.md §1`,
`docs/spec/02-data-model.md §1`, `serendip-protocol-v1.md`.

Artefacts:
- `src/packages/protocol/` with `signEvent`, `verifyEvent`, canonical
  `eventId`, kind validation against `kind-registry/kinds/*.json`
- Test suite covering: sign-verify round-trip, tampered payload
  rejected, invalid kind rejected, canonical id determinism

Checks:
- [x] `bun test --filter @agentxp/protocol` 100% green
- [x] Zero `legacy/` imports in `src/packages/protocol/`
- [x] Can `import { signEvent } from '@agentxp/protocol'` from another
      package in the workspace without setup friction
      (package published as `@serendip/protocol` per SPEC
      03-modules-platform §1; see commit `9ab8ac5`)

Expected duration: 2–3 days.

---

## M2 — Relay core routes (`@agentxp/supernode`)

Scope: SPEC module #2. Reference: `docs/spec/03-modules-platform.md §2`,
`docs/spec/01-interfaces.md §5.1–§5.5`.

Artefacts:
- `POST /events`, `POST /pulse/outcome`, `GET /events`, `GET /search`,
  identity endpoints
- SQLite-backed derived views per `02-data-model.md §6`

Checks:
- [x] Local server boots: `bun run supernode` listens on a port
- [x] `curl -X POST .../api/v1/events -d '<signed event>'` returns 200
- [x] The same event reappears via `GET /api/v1/search?q=...`
- [x] Signature rejection: tampered event returns 401/400

Expected duration: 3–5 days.

---

## M3 — Skill SKU (`@agentxp/skill`)

Scope: SPEC module #3. Reference: `docs/spec/03-modules-product.md §3`,
`docs/adr/ADR-001-reflection-trigger.md`.

Artefacts:
- npm-installable package with a thin CLI (`agentxp reflect`, etc.)
- `SKILL.md` prompt asset
- Local SQLite staging per `02-data-model.md §7.1`

Checks:
- [x] `bunx @agentxp/skill init` seeds a `SKILL.md` into a fresh dir
- [x] `bunx @agentxp/skill reflect` publishes a signed experience to
      a running M2 relay, confirmed by a `GET /search` query
- [x] Tier-1 (in-session) and Tier-2 (session-end) reflection paths
      each have a passing test

Expected duration: 3–4 days.

---

## M4 — Plugin v3 SKU (`@agentxp/openclaw-plugin`, internal path `src/packages/plugin-v3/`)

Scope: SPEC module #5. Reference: `docs/spec/03-modules-product.md §5`
(including the §5.1 Host hook surface added 2026-04-18).

Artefacts:
- Workspace-linked package (not published to npm — DP-4 T3=Y)
- Claude Code host adapter wiring the three hooks
- Local SQLite trace staging per `02-data-model.md §7.2`

Checks:
- [x] Synthetic session: 3 tool-call hook invocations + session-end
      produce 1 published experience with `reasoning_trace.steps.length
      === 3`
- [x] Tier-1 hook does NOT invoke the host LLM (token count = 0)
- [x] After a relay 503, local staging rows are retained and retried

Expected duration: 4–6 days.

---

## M5 — Observational surface (Dashboard, Pulse, Feedback, L2 Trace)

Scope: SPEC modules #7, #8, #9, #12. Reference: `03-modules-product.md
§7, §8, §9, §12`.

Artefacts:
- Dashboard static UI at `/dashboard`
- Pulse heartbeat events persisted and queryable
- Feedback loop: search_log + verification + pulse hooks
- `trace_references` rows materialised from `reasoning_trace` on ingest

Checks:
- [x] Browser visits `http://localhost:<port>/dashboard` and renders
      recent experiences from M2–M4 runs
- [x] `GET /api/v1/experiences/:id/trace` returns the trace built
      during M4
- [x] Dashboard is verified read-only (every POST returns 404/405)

Expected duration: 4–6 days.

---

## M6 — Skill-Hermes (Python port, lowest priority)

Scope: SPEC module #4. May be parallelised with M4/M5 if capacity allows.

Check: feature parity with M3 against the same M2 relay.

Expected duration: 3–4 days.

---

## MVP-DONE — End-to-end acceptance

All of M0–M6 `DONE`, plus:
- [x] End-to-end test: Skill + Plugin v3 both publish to one relay,
      Dashboard shows both, a cross-reference `trace_references` row
      exists between them
      (see `scripts/mvp-done-smoke.sh`, commit `f454845`)
- [x] Zero `legacy/` imports anywhere under `src/`
      (enforced by `scripts/check-no-legacy-imports.sh`)
- [x] SPEC gaps GAP-1…GAP-4 from `.spec-v41-check` round 2 each
      closed by the commit that needed them (verified by commit log)
      — all four closed by `60a9c54` (pre-branch); reproducible with
      `git log --all --grep=GAP --oneline`.

Status: **DONE** on `f454845`. Tagged `mvp-v0.1.0`. Ready to open a
PR from `feat/v0.1-impl` into `main`.


---

## M7 — Plugin v3 shippable as OpenClaw plugin (post-MVP)

Scope: ship `@agentxp/openclaw-plugin` (renamed from the internal
SKU `@agentxp/plugin-v3` in M7 Batch 1 after a registry-name
collision) as a real OpenClaw plugin to npm public + GitHub. The
workspace directory stays at `src/packages/plugin-v3/` for now.
Decision recorded in `docs/adr/ADR-004`. Split into two batches;
Batch 1 must land before Batch 2 begins.

This milestone is **post-MVP**. Nothing under `mvp-v0.1.0` is
changed; the MVP SPEC freeze (DP-4 T3=Y) holds for the tagged
release and is superseded by ADR-004 only for subsequent work.

### Batch 1 — adapter + manifest + full lifecycle hook surface

Artefacts:
- `src/packages/plugin-v3/openclaw.plugin.json` manifest with
  `configSchema` (operator pubkey, agent key, relay URL,
  visibility default)
- `src/packages/plugin-v3/src/adapter.ts` exporting
  `definePluginEntry({ id: 'agentxp', register(api) {...} })`
- Three new hook handlers: `onSessionStart`, `onBeforeToolCall`,
  `onAgentEnd`. The existing `onMessageSending` / `onToolCall` /
  `onSessionEnd` are reused unchanged.
- All six hooks registered via `api.on(...)` in the adapter
- `package.json`: `"private": true` removed;
  `publishConfig.access: "public"`; `files` includes
  `openclaw.plugin.json`; optional peer dep
  `"openclaw": ">=2026.4.15"`

Checks:
- [ ] `npm run build -w @agentxp/openclaw-plugin` produces `dist/`
      with `adapter.js` and all six hook exports present
- [ ] New Vitest suites cover `onSessionStart`,
      `onBeforeToolCall`, `onAgentEnd` (each with happy / edge /
      error cases) and an adapter integration test with a mocked
      `OpenClawPluginApi`
- [ ] `tsc --noEmit` green on both `tsconfig.json` and
      `tsconfig.test.json`
- [ ] `npm publish --dry-run -w @agentxp/openclaw-plugin` shows the
      manifest file and `dist/` in the tarball; no test files, no
      SQLite DBs, no `src/`

### Batch 2 — memory supplement injection

Artefacts:
- `src/packages/plugin-v3/src/memory-corpus.ts` — re-implementation
  of the legacy corpus supplement against the SPEC §5 contract
- `src/packages/plugin-v3/src/memory-prompt.ts` — re-implementation
  of phase-aware prompt supplement (stuck / evaluating / planning /
  executing)
- Adapter wires both via `api.registerMemoryCorpusSupplement(...)` /
  `api.registerMemoryPromptSupplement(...)`

Checks:
- [x] With a non-empty local DB, corpus supplement returns at least
      one candidate for a context whose keywords intersect a staged
      experience's tags
- [x] Empty local DB → zero injections (no errors, no default noise)
- [x] Visibility enforcement: private experiences are not returned
      when the supplied scope is `public-only`

### M7-DONE — Publish + verify

- [ ] `npm publish --access public -w @agentxp/openclaw-plugin`
      succeeds for prerelease tag `v0.2.0-rc.1`
- [ ] A real OpenClaw host (v2026.4.15+) installs the published
      tarball and the plugin loads without runtime errors
- [ ] End-to-end smoke: one agent session on the OpenClaw host
      produces at least one experience that reaches
      `https://relay.agentxp.io` and shows up in the Dashboard
- [ ] Stable `v0.2.0` tag cut after 72 h of clean operation

Expected duration: 4–6 days for Batch 1, 3–4 days for Batch 2, plus
the verify window.
