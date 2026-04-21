# Spec Survey

> Output of BOOTSTRAP.md §3 Step 1. Read-only map of the repository as it
> stands on 2026-04-18, produced before any SPEC is written. Hand this to
> the project lead for confirmation before entering Step 2 (decision
> dialogue). No code or existing documents were modified to produce this.

## 1.1 Documentation map

### Active (kept outside `legacy/`, considered current truth)

| Path | Role | Last modified |
|---|---|---|
| `README.md` | User-facing pitch, install, API endpoints, §10 Fairness Charter | 2026-04-17 |
| `CHANGELOG.md` | Release notes. v4.0.0 shipped 2026-04-12 | 2026-04-17 |
| `CONTRIBUTING.md` | Branch strategy (GitHub Flow), PR checklist, code style | 2026-04-17 |
| `BOOTSTRAP.md` | This workflow (self-retires when done) | 2026-04-18 |
| `docs/legacy-sweep-plan.md` | Step 0.5 archival plan (executed) | 2026-04-18 |
| `docs/ops/2026-04-18-feedback-loop-rollout.md` | Live runbook. Merge order, deploy via rsync, smoke test | 2026-04-18 |
| `.augment/rules/{superpowers,agent-skills}.md` | Workflow rules for the BOOTSTRAP agent | 2026-04-18 |
| `.github/ISSUE_TEMPLATE/sip.md` | Serendip Improvement Proposal template | 2026-04-17 |
| `kind-registry/README.md` | Reverse-DNS kind naming convention | 2026-04-17 |
| `packages/skill/{README,SKILL,SKILL-GUIDE}.md` | OpenClaw Skill (v1.2.0) | 2026-04-17 |
| `packages/skill-hermes/{README,SKILL}.md` | Python port of Skill for Hermes Agent | 2026-04-17 |
| `packages/openclaw-plugin/README.md` | OpenClaw Plugin v1.0.0 (workspace-local) | 2026-04-17 |
| `agents/coding-01/{SOUL,AGENTS,BOUNDARY,CURIOSITY,HEARTBEAT}.md` | Contribution agent instance | 2026-04-17 |
| `agents/templates/*.md` | Agent instance templates | 2026-04-17 |
| `packages/skill/templates/{preloaded-lessons,preloaded-mistakes,reflection-format}.md` | Seeded reflections + format contract | 2026-04-17 |

### Archived (under `legacy/`, snapshot from BOOTSTRAP §0.5)

Thinking notes and superseded plans. Retained for provenance and for
`Legacy Reference` fields in the eventual SPEC.

| Path (relative to `legacy/`) | Nature |
|---|---|
| `docs/spec/serendip-protocol-v1.md` | Protocol draft (352 lines, Status: Draft, 2026-04-12) |
| `docs/plans/2026-04-12-agentxp-v4-design.md` | v4 Design Document (1780 lines) — the canonical thinking note |
| `docs/plans/2026-04-12-phase-{a,b,cd,e,fghi,human-layer}-tdd-spec.md` | v4 implementation plan, Phase A-I + HL |
| `docs/plans/2026-04-12-cold-start-pipeline-design.md` | Cold-start pipeline design |
| `docs/plans/2026-04-12-ci-fix.md` | CI repair plan |
| `docs/plans/2026-04-16-plugin-design.md` | Pivot doc: Skill → Plugin (2026-04-16) |
| `docs/plans/2026-04-16-plugin-implementation.md` | Plugin implementation plan |
| `docs/plans/2026-04-16-plugin-context.md` | Session handoff note |
| `docs/plans/plugin-v2/00..18-*.md` (+ `context-handoff.md`) | Plugin v2 task-level plan (19 files) |
| `docs/plugin-v3-test-report.md` | Plugin v3 test report (2026-04-18) |
| `docs/all-experiences-export{,-zh}.md` + `.pdf` | Product data snapshot |
| `docs/zh/{agentxp-v4-design-zh,serendip-protocol-v1-zh}.md` + `.pdf` | Chinese translations |
| `CLAUDE.md` | Previous project rules (Claude Code format) |
| `.claude/agents/{gstack,superpowers}.md` | Claude Code agent definitions |
| `<uuid>.md` × 6 | **Three unique documents × two copies each** (verified by SHA-1): `18829805≡aa0dcdd1` = Plugin v3 merged design (41 KB); `aa3d3d78≡bd1ec428` = Plugin v2 merged design (72 KB); `b33cfc1b≡f6359a96` = v4 design (86 KB, identical to `docs/plans/2026-04-12-agentxp-v4-design.md`). See Gap G11. |

## 1.2 Code reality

### Layout

```
packages/
  protocol/       @agentxp/protocol v1.0.0     — events / keys / merkle / types
  skill/          @agentxp/skill   v1.2.0      — OpenClaw Skill + `agentxp` CLI
  skill-hermes/   (no package.json)            — Python port for Hermes Agent
  plugin-v3/      @agentxp/plugin-v3 v1.0.0    — OpenClaw Plugin (workspace-only)
  plugin/         empty (stale v1/v2 stub)
supernode/        @agentxp/supernode v0.1.0    — Relay (Hono + better-sqlite3)
agents/           contribution agents (coding-01) + templates
kind-registry/    JSON-Schema registry for `io.agentxp.*` kinds
tests/            cross-cutting infra + integration
scripts/          setup-dev, release, smoke-test-feedback-loop
```

Root workspaces: `packages/*` + `supernode`. Note `agents/` has its own
`package.json` / `vitest.config.ts` outside the root workspace list.

### Stack

TypeScript (ESM, strict), Node.js. Hono on `@hono/node-server`,
`better-sqlite3` 12.8, `@noble/curves` + `@noble/hashes` for Ed25519 +
SHA-256, `zod` for schemas. OpenAI `text-embedding-3-small` for server-
side embeddings (supernode/src/index.ts:23). Vitest for tests. Docker +
Caddy for deploy. PM2 in production.

### Current live system

- Relay running at `https://relay.agentxp.io` (pm2 id 17, VPS
  `154.12.191.239`, DB `/opt/agentxp/data/agentxp.db`, 403 experiences,
  0 relay_nodes).
- REST API on `/api/v1/*` (routes in `supernode/src/routes/`): events,
  experiences, identities, nodes, metrics, pulse, sync, subscriptions,
  visibility, cold-start, dashboard-api, dashboard-static.
- 7 migrations applied (`001_initial.sql` … `007_reasoning_trace.sql`).
- Test inventory ≈ 100 files across four packages, organised by Phase
  letter (A-I + HL) per the legacy v4 TDD specs.
- Smoke test `scripts/smoke-test-feedback-loop.ts` exercises
  publish → search → pulse → verify → pulse (5 steps).

### Minimum runnable flow

`./scripts/setup-dev.sh` boots a local Supernode on
`http://localhost:3141` with dashboard at `/dashboard`. A separate
install flow (`packages/skill/scripts/post-install.mjs`) sets up the
Skill side: generates Ed25519 identity into `~/.agentxp/identity/`,
seeds `reflection/*.md`, patches `AGENTS.md`, points at the live relay.

## 1.3 Contradictions, gaps, and ambiguities

Listed as `G<n>` for reference in §1.4. Each entry cites evidence.

- **G1 · Two client implementations coexist without a declared MVP
  boundary.** `packages/skill/` (v1.2.0, on the npm-publish path) is the
  Skill approach — prompt-driven, platform-agnostic, ships the
  `agentxp` CLI. `packages/openclaw-plugin/` (v1.0.0, workspace-local only) is
  the Plugin approach — code-level hooks against the OpenClaw Plugin
  SDK. `legacy/docs/plans/2026-04-16-plugin-design.md:16` explicitly
  proposes replacing Skill with Plugin, keeping Skill as "degradation
  fallback", but `README.md:24-30` still presents Skill as the primary
  install path. `docs/ops/2026-04-18-feedback-loop-rollout.md:146-149`
  states plugin-v3 has no npm publish / no bundled install path. Empty
  `packages/plugin/` directory suggests an abandoned v1/v2 scaffold.

- **G2 · Phase / milestone labelling conflicts.** v4 uses
  Phase A → I + HL (`legacy/docs/plans/2026-04-12-phase-*-tdd-spec.md`).
  Plugin v2 uses Task 1-18. Plugin v3 uses "6-phase plugin entry"
  (`packages/openclaw-plugin/README.md:51`). `legacy/CLAUDE.md:151` still
  references Phase A-I + HL as the active plan. BOOTSTRAP §2 flags
  "v1/v2/v3 three timelines + Phase A-I and Phase 1-5 two splits".

- **G3 · Reflection trigger mechanism not settled across clients.**
  `packages/skill/SKILL.md:49` states reflection happens "On heartbeat /
  session end" (prompt-driven, relies on agent compliance).
  `packages/openclaw-plugin/README.md:57` uses a `message-sending` hook to
  extract automatically + `agent-end` to prompt structured reflection
  (code-driven). `README.md:40-48` promises "automatic" reflection
  without naming the mechanism. Session end, heartbeat, idle timeout,
  task completion are all used as phrases; the concrete trigger is
  different per client.

- **G4 · Reflection vocabulary has no formal hierarchy.** `mistake`,
  `lesson`, `feeling`, `thought`, `reflection`, `experience` appear
  across `README.md`, `SKILL.md`, `templates/*.md`, v4 §5. Protocol
  only defines `io.agentxp.experience`
  (`legacy/docs/spec/serendip-protocol-v1.md:65`). v4 §5.4 defines a
  single machine-parseable format but does not say whether `mistake`
  and `lesson` are subtypes of `experience`, local-only projections,
  or separate kinds.

- **G5 · Transport protocol: WebSocket claimed, HTTP shipped.**
  `legacy/docs/plans/2026-04-12-agentxp-v4-design.md:137` states
  "Transport: WebSocket + signed JSON". `packages/openclaw-plugin/README.md:38`
  shows `"relayUrl": "wss://relay.agentxp.io"`. Actual relay is HTTP:
  all `supernode/src/routes/*.ts` use Hono HTTP routes, smoke test uses
  `RELAY_URL=https://...` via fetch, README API section lists only
  REST endpoints, `legacy/docs/spec/serendip-protocol-v1.md:144-200`
  specifies REST. No WebSocket code present in `supernode/src/`.

- **G6 · MVP scope boundary vs. post-MVP experimentation.** CHANGELOG
  v4.0.0 (2026-04-12) lists core protocol + skill + supernode +
  contribution agents + kind registry + CI + dashboards as "Added".
  Plugin v3 arrived after 2026-04-16, is workspace-only. Feedback loop
  (search_log, verification_log, pulse hooks) deployed 2026-04-18.
  There is no single document that freezes "these modules belong to
  the SPEC". BOOTSTRAP §2 explicitly names this: "MVP 边界: v1/v2/v3
  three timelines + Phase A-I and Phase 1-5 two stage splits coexist".

- **G7 · Human Layer status unclear.** `legacy/CLAUDE.md:78` lists
  Human Layer as goal #4 ("letters, trust, agent-voice, contribution").
  `legacy/docs/plans/2026-04-12-phase-human-layer-tdd-spec.md` exists,
  `supernode/src/agentxp/human-layer/` exists, `supernode/tests/HL*.test.ts`
  exist, `agents/tests/H*.test.ts` exist. But `README.md` and
  `CHANGELOG.md` do not mention it. Whether Human Layer is MVP,
  post-MVP, or experimental is not declared.

- **G8 · CLI surface not centrally specified.** `README.md:52` shows
  `agentxp publish`. `CHANGELOG.md:63` lists `status`, `install`,
  `dashboard`, `config`, `update`. `legacy/docs/plans/2026-04-16-plugin-design.md:132-140`
  references `agentxp pause/resume/unpublish --last`.
  `packages/skill/src/cli.ts` is the only source of truth. No spec
  enumerates the authoritative command set or lifecycle.

- **G9 · Contribution agents: product feature vs. research
  experiment?** `legacy/docs/plans/2026-04-12-agentxp-v4-design.md §10`
  defines them; `agents/coding-01/` has a full SOUL/BOUNDARY/CURIOSITY
  system with templates; tests exist. Not referenced in `README.md` or
  `CHANGELOG.md`. Whether this is a first-class product capability,
  an optional example, or internal research is unstated.

- **G10 · Data truth source not fixed.** v4 §2.4 (line 148-151) says
  "local sovereign copy" is primary with relay as cache/index. Relay
  has authoritative SQLite at `/opt/agentxp/data/agentxp.db`. Skill
  has a separate local SQLite (search + recall). Plugin v3 has yet
  another local SQLite (memory corpus + trace). Operator rebuild,
  identity recovery, multi-device sync — no document specifies which
  store wins in any of these cases.

- **G11 · Six UUID-named docs in `legacy/` are three documents ×
  two duplicates.** Verified by SHA-1 hashing: each unique document
  has two byte-identical copies. The v4-design pair is additionally
  byte-identical to `legacy/docs/plans/2026-04-12-agentxp-v4-design.md`.
  No information loss from pruning the extras; keeping all six adds
  noise to `Legacy Reference` lookups later.

- **G12 · `CLAUDE.md`-pattern files in `legacy/` are still loaded as
  agent rules.** Augment Code matches rule files by basename,
  ignoring path. After the §0.5 archival, `legacy/CLAUDE.md` continues
  to be injected as a supervisor rule, and `agents/coding-01/AGENTS.md`
  is injected the same way. Not a SPEC contradiction per se, but
  affects how rules will graduate in §5. Resolution deferred per
  earlier agreement.

## 1.4 Decision points (8, ordered by priority)

Each point is labelled `P` (product), `T` (technical with product
impact), or `C` (cleanup). Priorities H / M / L reflect how many
downstream gaps resolve once decided.

### DP-1 · Product identity: Skill, Plugin, or both

- Evidence: G1, G2. Skill ships on npm path; Plugin v3 is
  workspace-only; `2026-04-16-plugin-design.md` argues Plugin replaces
  Skill; README still centres on Skill.
- Why it matters: decides MVP install flow, packaging, documentation
  structure, the `Legacy Reference` map, and the entire SPEC module
  list in `03-modules-platform.md` + `03-modules-product.md`.
- Type / priority: **P / H**.

### DP-2 · Reflection unit and vocabulary

- Evidence: G4. `mistake`, `lesson`, `feeling`, `thought`,
  `reflection`, `experience` all in use; `io.agentxp.experience` is
  the only signed kind.
- Why it matters: names in the SPEC glossary, schema boundaries
  between local and network, what gets published vs. kept private,
  what the agent is told to write.
- Type / priority: **P / H**.

### DP-3 · Reflection trigger mechanism

- Evidence: G3. Skill is prompt-compliance-driven; Plugin v3 is
  hook-driven; README claims "automatic" without commitment.
- Why it matters: the example BOOTSTRAP §2 uses. Decides how testable
  "reflection happened" is, and user-visible latency.
- Type / priority: **T / H** (technical but user-visible).

### DP-4 · MVP scope freeze

- Evidence: G6, G7, G9. No document enumerates what is in MVP.
- Why it matters: every other decision presupposes this. Without it
  the SPEC will drift into "everything currently shipped counts".
- Type / priority: **P / H**.

### DP-5 · Data truth source

- Evidence: G10. Three SQLites (relay, skill, plugin-v3) + Merkle
  doctrine. No recovery contract specified.
- Why it matters: operator-rebuild story, identity recovery,
  multi-device (future), `02-data-model.md` authoritative-vs-cache
  labels.
- Type / priority: **P / H**.

### DP-6 · Transport protocol

- Evidence: G5. Design says WebSocket; code is HTTP; Plugin v3
  config sample uses `wss://`.
- Why it matters: decides `01-interfaces.md` signatures; affects
  subscription and pulse semantics; retires the `wss://` references
  in current docs.
- Type / priority: **T / M** (has product impact via realtime UX).

### DP-7 · Human Layer placement

- Evidence: G7. Code + tests exist; README silent.
- Why it matters: decides whether Human Layer modules appear in
  `03-modules-product.md` (with `Legacy Reference`) or move to `04-deferred.md`
  (YAGNI).
- Type / priority: **P / M**.

### DP-8 · Legacy UUID duplicates cleanup

- Evidence: G11. Three unique docs, two copies each.
- Why it matters: minor quality-of-life for `Legacy Reference`.
- Type / priority: **C / L**.

Not in the list but tracked: G2 (phase labelling), G8 (CLI surface),
G12 (rule-file injection). G2 and G8 collapse once DP-1 and DP-4 are
decided; G12 is a tooling concern for §5, not a SPEC decision.

## Next step

Hand this survey to the project lead. On confirmation, enter Step 2
(decision dialogue) starting with DP-1. If any decision point is
missing, misstated, or mis-prioritised, this file is amended before
we proceed.
