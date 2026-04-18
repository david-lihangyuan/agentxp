# Spec In Progress

> Live ledger of the BOOTSTRAP §3 Step 2 decision dialogue.
> Updated after every round. States: DECIDED · IN DISCUSSION · PENDING.
> Source of the decision points: `docs/spec-survey.md` §1.4.

## Status

| # | Decision point | State | Decision | Notes |
|---|---|---|---|---|
| DP-1 | Product identity: Skill / Plugin / both | DECIDED | **C · Dual SKU parallel** (Skill + Plugin are both MVP first-class) | See log |
| DP-2 | Reflection unit and vocabulary | DECIDED | **A · Single canonical unit `experience`** | See log |
| DP-3 | Reflection trigger mechanism | DECIDED (AI-recommended provisional default) | **C · Hybrid (in-session extraction + end-of-session structured reflection)** | User took recommendation; see log |
| DP-4 | MVP scope freeze | DECIDED | **9 modules in MVP; #11 removed from production; #10/#12/#13/#14/#15 deferred; Plugin v3 workspace-only; Skill/Plugin trace asymmetric** | See log |
| DP-5 | Data truth source | DECIDED | **C · Event log is the source of truth; local and relay are derived views** | User-authored; reasons: protocol alignment + offline support |
| DP-6 | Transport protocol | DECIDED | **1-a + 2-n: HTTP-only client↔relay; multi-relay sync deferred** | User-informed; see log |
| DP-7 | Human Layer placement | DECIDED (subsumed into DP-4) | **Deferred + slated for production removal in §4.3** | See DP-4 partial log |
| DP-8 | Legacy UUID duplicates cleanup | DECIDED | **C · Thorough dedupe + rename survivors** | 4 deletes, 2 renames committed as `ece2210` |

## Decision log

### DP-1 · Product identity (confirmed 2026-04-18)

Decision: **C — Dual SKU parallel.**

- `packages/skill/` (platform-agnostic, prompt-driven, on npm publish
  path) and `packages/plugin-v3/` (OpenClaw-only, hook-driven) are both
  first-class MVP product lines. `packages/skill-hermes/` is treated as
  a platform port of the Skill SKU.
- Implication for SPEC: `03-modules-product.md` splits into Skill-side
  and Plugin-side sections, each with its own `Legacy Reference` map.
- Pivot note `legacy/docs/plans/2026-04-16-plugin-design.md` §1
  ("Plugin replaces Skill, Skill as fallback") is recorded in
  `HISTORY.md` as **not adopted**. Its experimental data on Skill
  execution determinism (19-87%) stands but does not force a rewrite.
- Open follow-up (parked for DP-4): Plugin v3 is currently
  workspace-only with no npm publish path. DP-4 must decide whether
  "npm publish for Plugin v3" is in MVP or acceptable as
  "dual SKU but Plugin ships via git-clone for now".

### DP-2 · Reflection unit & vocabulary (confirmed 2026-04-18)

Decision: **A — single canonical unit, `experience`.**

- Protocol keeps a single signed kind: `io.agentxp.experience`.
- `mistakes.md` / `lessons.md` / `feelings.md` / `thoughts.md` are
  Skill-local file organisation, not a SPEC-level taxonomy. Plugin v3
  keeps its own local layout (`local_lessons`, `trace_steps`) without
  alignment to Skill.
- Distillation (v4 §5.6 "5+ similar mistakes → lesson") remains a
  local operation; its output is still an `experience`, related to
  inputs via the existing `extends` / `qualifies` / `supersedes`
  payload fields (`legacy/docs/spec/serendip-protocol-v1.md:84-86`).
  No new kind added; `kind-registry/` unchanged.
- `05-glossary.md` will list `reflection` / `mistake` / `lesson` /
  `feeling` / `thought` only as Skill-local file categories, not as
  protocol-level concepts. README marketing language ("mistakes &
  lessons") is unaffected.
- Most YAGNI option: no protocol change, no kind addition, no
  distillation-product kind.

### DP-3 · Reflection trigger timing (provisional, AI-recommended)

Decision: **C — hybrid, two-tier trigger.**

> **Important provenance flag**: the user selected C by accepting the
> AI recommendation after declaring "not clearly familiar" with the
> concept (BOOTSTRAP §3 C-track). This is an **AI-recommended
> provisional default**, not a user-authored decision. An ADR will be
> written in Step 3 recording this explicitly. Revisit permitted at
> any time.

- In-session layer: lightweight rule-based extraction per
  message-sending (Plugin hook) / "5+ tool call mid-task self-check"
  hint in SKILL.md (Skill). Zero or near-zero LLM tokens.
- End-of-session layer: structured reflection at session boundary —
  defined as CLI exit / idle timeout / explicit `agentxp reflect`
  command (contract to be sharpened in `01-interfaces.md`).
- Both SKUs (`packages/skill` and `packages/plugin-v3`) MUST honour
  this two-tier contract; implementation mechanism differs by SKU per
  DP-1 (prompt for Skill, hook for Plugin).
- Aligned with the Tier 1 / Tier 2 extraction distinction in
  `legacy/docs/plans/2026-04-12-agentxp-v4-design.md` §5.6.
- Rejected alternatives: A (task-level) — "task boundary" ill-defined
  for conversational agents; B (session-only) — loses in-session
  signal that Plugin and Skill both rely on today.
- Trade-off: highest documentation + test surface of the three
  options; accepted because it matches what already runs in
  production.

### DP-4 · MVP scope freeze (confirmed 2026-04-18)

Decision: **9 modules in MVP. #11 removed from production. #10 / #12
originally → #12 lifted into MVP per user override. #13 / #14 / #15
deferred.** Plugin v3 stays workspace-only (no npm publish in MVP).
Skill and Plugin have asymmetric reasoning-trace obligations.

**MVP modules (9) — `03-modules-platform.md` + `03-modules-product.md`
write contract for each:**

| # | Module | Path |
|---|---|---|
| 1 | Protocol core | `packages/protocol/` |
| 2 | Relay core routes (events / search / identities) | `supernode/src/routes/{events,experiences,identities}.ts` |
| 3 | Skill | `packages/skill/` |
| 4 | Skill-Hermes (Python port of Skill) | `packages/skill-hermes/` |
| 5 | Plugin v3 | `packages/plugin-v3/` |
| 6 | Kind registry | `kind-registry/` |
| 7 | Dashboard (observational UI only) | `supernode/src/routes/dashboard-*.ts` |
| 8 | Pulse | `supernode/src/agentxp/pulse*.ts`, migration 002 |
| 9 | Feedback loop (search_log + verification + pulse hooks) | Shipped 2026-04-18 |
| 12 | L2 Reasoning Trace | `supernode/src/agentxp/trace-*.ts`, migration 007, `packages/protocol/src/types.ts:154 ReasoningTrace`, `packages/plugin-v3/db.ts` trace_steps |

**Deferred modules — `04-deferred.md` records with reason, code stays running:**

| # | Module | Reason | §4.3 action |
|---|---|---|---|
| 10 | Contribution agents (coding-01, templates) | Internal content operations, not a protocol contract | No removal — code continues |
| 11 | Human Layer | Product scope: AgentXP serves Agents, not human-relationship UX | **Removal**: strip 5 `register*Routes` from `app.ts:30-34`, relocate `human-layer/` to `legacy/`. DB columns `contributor_type` / `trust_weight` survive with defaults (harmless) |
| 13 | Cold-start pipeline | Introduces 4 extra protocol kinds (conflicts with DP-2's single-kind principle); content seeding is internal ops | No removal — code continues, 4 kinds stay out of SPEC |
| 14 | Weekly report | Emotional-narrative tone (same character as deferred #11 HL4 milestones); no tests | No removal — code continues; future rewrite may strip narrative or relocate |
| 15 | A/B experiments | Research tool, research scale (6 pubkeys), not a product-level contract | No removal — code continues |

**Sub-decisions:**

- **T3 · Plugin v3 npm publish in MVP = Y (no).**
  `03-modules-product.md §5` declares: *"workspace-only install for
  MVP; npm publish deferred"*. `packages/plugin-v3/package.json` does
  not need a publish config change in §4.3.
- **T4 · Deferred code fate = y (stays).** #10 / #13 / #14 / #15 code
  remains in `supernode/` and `agents/` trees through §4 rewrite. Only
  #11 is physically relocated.
- **T5 · Reasoning-trace obligation asymmetric = b.**
  - Plugin v3: MUST produce `reasoning_trace` for every published
    experience. `03-modules-product.md §5` declares this MANDATORY.
  - Skill: trace production OUT OF SCOPE for MVP. `reasoning_trace`
    field MAY be null. `03-modules-product.md §3` declares this
    explicitly. Future upgrade path left open.
  - Relay: accepts both (schema marks `reasoning_trace` optional).
  - `01-interfaces.md` records this asymmetry verbatim.

**Implementation gaps surfaced by lifting #12 — revised during SPEC
review (2026-04-18):**

1. **No dedicated `/traces/*` URL surface in MVP.** Trace data is
   carried end-to-end via `ExperiencePayload.reasoning_trace`
   (protocol-level field) and accessed through existing
   `/events` and `/experiences/*` endpoints. `03-modules-product.md §12`
   makes this normative; a future SPEC minor version **MAY** add a
   `/traces/*` surface via the deferred re-entry process.
2. **Trace-feedback carrier, if added, SHOULD ride the kind system**
   (e.g. a new `io.agentxp.trace-feedback` kind registered under
   `kind-registry/`), not a new URL. This keeps the MVP endpoint
   surface at the 9-module floor.
3. Original `trace-api.ts` + `trace-analytics.ts` + `trace-sanitize.ts`
   stay in `supernode/src/agentxp/` as library code; they are **not**
   wired to HTTP routes in MVP.
4. Zod schema work for trace payloads is therefore deferred with the
   rest of the `/traces/*` re-entry work.

**Resolved by this decision:**

- DP-7 (Human Layer placement) — subsumed; removed from the queue.
- DP-2 retained as-is (single canonical kind) — because #13 cold-start's
  4 extra kinds are deferred, they stay out of protocol SPEC.

**Not a user-authored principle; AI-flagged for record:**

User's product principle — *"AgentXP 核心是针对 Agent，在人文层面其实
不需要"* — was interpreted as the **narrow read (P1)**: cut
relationship-type / emotional-narrative surfaces (letters / trust
ladders / milestones / legacy view / weekly narrative), keep
observational surfaces for operators (dashboard / pulse / feedback
loop). User explicitly confirmed P1. #7 Dashboard is therefore MVP.
This reading is recorded so a later maintainer does not misinterpret
the principle as "no operator-facing UI at all".

### DP-5 · Data source of truth (confirmed 2026-04-18)

Decision: **C — the signed event log is the canonical source of truth.
Both local stores (Skill files, Plugin v3 SQLite) and Relay DB are
derived, materialised views.**

**Provenance**: user-authored. User opened C-track (unfamiliar with
event-sourcing) and was walked through the three options, but then
articulated the two reasons themselves and locked the decision. Not an
"AI-recommended provisional default" — user owns this one.

**User's two reasons (verbatim):**

1. *"1 应该要和我们的协议一致吧？"* — SPEC must align with the
   protocol layer, which is already append-only / event-sourced.
2. *"它要能支持本地数据，也就是在不联网的情况下也能使用"* — the
   product must support local data / offline operation.

**SPEC consequences:**

- "Edit a published experience" = publish a NEW signed event with
  `supersedes` / `extends` / `qualifies` referencing the old one. The
  old event is never mutated. Protocol fields at
  `legacy/docs/spec/serendip-protocol-v1.md:84-86` support this natively.
- Relay DB is a materialisation of the event stream, not authoritative
  state. If relay DB drifts from event log, event log wins.
- Local stores (Skill's `*.md` files, Plugin v3's SQLite) are derived
  views. `01-interfaces.md` must specify the mapping (event → view),
  not the inverse.
- Offline write is supported natively (signing is local; events queue
  locally; flush on reconnect).
- Offline read of **own** experiences is supported natively (the
  operator signed them; they are locally derivable).
- Offline read of **others'** experiences is **not** a protocol-level
  guarantee — it requires a local cache of relay events. This is a
  transport / caching decision, deferred to DP-6.

**MVP scope caveats (to prevent over-engineering):**

- Full event-log replay engine (rebuild local files from event stream)
  is a **design capability**, not an MVP deliverable.
  `03-modules-product.md §3 & §5` declare the write path (experience →
  event → local + relay) but the reverse path (event → rebuild local)
  may be partial in MVP.
- `agentxp pull` (replay all events signed by my pubkey to restore
  local state on a new machine) is deferred to `04-deferred.md`.
  Listed there as "known design capability, implementation not in
  MVP". Future work enabled, not blocked.
- SKILL.md must explicitly instruct agents: *"do not edit past
  reflections; create a new one with `supersedes` pointing to the
  earlier event."* Text update scheduled for §4.3.

**Rejected alternatives:**

- A (local-first, relay read-only): breaks disaster recovery and
  contradicts the protocol's Merkle-chained event semantics.
- B (relay-first, local as working copy): breaks offline use and
  introduces a relay SPOF at the product-contract layer.

### DP-6 · Transport protocol (confirmed 2026-04-18)

Decision: **1-a + 2-n — HTTP REST only between client and relay;
multi-relay sync deferred.**

**Provenance**: user-informed. User opened C-track (unfamiliar with
HTTP vs WebSocket and single-vs-multi-relay concepts), heard the
non-technical explanation, reviewed reasoning + counterargument, and
selected (1) "accept recommendation with informed agreement". Not a
blind AI default; user engaged with the trade-offs.

**Layer 1 · Client ↔ Relay:**

- MVP contract: **HTTP REST only**. `01-interfaces.md` enumerates
  endpoints under `/api/v1/*` (events, search, identities, pulse,
  experiences, dashboard-api).
- URL scheme accepts `http://` / `https://`; `ws://` / `wss://`
  prefixes are auto-normalised to HTTP form by clients (this
  normalisation is kept in MVP for config-file backward compatibility
  but not part of the transport contract).
- Reason: (a) Skill + Plugin v3 clients de facto use HTTP only today;
  (b) smallest portable contract surface for third-party clients;
  (c) HTTP `GET /events?author=<pubkey>` covers DP-5's disaster
  recovery scenario without needing push transport.

**Layer 2 · Relay ↔ Relay sync:**

- **Deferred**. `supernode/src/protocol/sync.ts` and
  `node-registry.ts` code continues running (consistent with T4=y
  baseline); SPEC does not lock its contract.
- Aligned with existing project principle in `legacy/CLAUDE.md`:
  *"单一 Relay 先行 - 多 Relay 同步是未来目标，现在 YAGNI"*.
- `04-deferred.md` records this with reason + code path, future
  expansion explicitly left open.

**WebSocket status:**

- `supernode/src/protocol/connection-manager.ts` (WebSocket pool,
  ping/pong, 1000-concurrent cap, rate limiting) stays implemented
  but unused by Skill / Plugin v3 clients.
- **Not in MVP SPEC contract.** `04-deferred.md` lists it as
  "server-side implementation present, client-side consumption out
  of MVP; future real-time subscription features may adopt".

**Accepted trade-offs (on the record):**

- Real-time push to agents (e.g. "a newly published experience
  matches your current context, pushed to you live") is not an MVP
  capability. Clients poll via HTTP.
- Single-relay SPOF is accepted. `relay.agentxp.io` going down ==
  publish/search unavailable during that window. SPEC must state
  this honestly; the word "decentralised" in README / CLAUDE.md must
  be qualified as "protocol is decentralisable, MVP ships with one
  relay" during §4 rewrite.

**Rejected alternatives:**

- 1-b (HTTP + WebSocket dual contract): adds a client-side
  implementation burden with no observed user need today.
- 1-c (WebSocket-primary): major rewrite, no justification.
- 2-y (multi-relay sync in MVP): contradicts the existing
  "single-relay first" principle and adds substantial test surface.
- 2-r (remove multi-relay code): no evidence the direction is wrong,
  only that it is early.

### DP-8 · Legacy UUID duplicates cleanup (confirmed 2026-04-18)

Decision: **C — thorough byte-level dedupe, survivors renamed.**

**Byte-level evidence (shasum)**: the 6 root-level UUID markdown files
under `legacy/` were three pairs of identical content.

| SHA prefix | Deleted | Kept |
|---|---|---|
| `2196047216b4` (88KB, v4 design) | `b33cfc1b-...md`, `f6359a96-...md` | `legacy/docs/plans/2026-04-12-agentxp-v4-design.md` (canonical, semantic filename) |
| `12b99d15bb73` (44KB, Plugin v3 monolith) | `aa0dcdd1-...md` | `legacy/18829805-...md` → **renamed** `legacy/plugin-v3-design-monolith.md` |
| `e541d1697060` (72KB, Plugin v2 monolith) | `bd1ec428-...md` | `legacy/aa3d3d78-...md` → **renamed** `legacy/plugin-v2-design-monolith.md` |

**Why not keep the UUID names** (reverted from the strict "legacy =
original preservation" principle): UUIDs carry zero semantic info; mtimes
of all 6 files are identical (same archive commit), so no time-ordering
info is lost; original files had no independent git blame (added in a
single sweep commit). Future maintainers cite `legacy/plugin-v3-design-monolith.md`
in `HISTORY.md` without UUID confusion.

**Why Plugin v2/v3 monoliths kept (not further deduped against plans/)**:
`legacy/docs/plans/2026-04-16-plugin-*.md` are pivot notes (8.9KB), not
the full 44KB Plugin v3 design. `legacy/docs/plans/plugin-v2/` is 22
split files — same content as the monolith but organisationally
different; the monolith form retains standalone readability.

**Commit**: `ece2210 chore(legacy): dedupe byte-identical UUID copies
and rename survivors` — 6 files changed, 7304 deletions, 0 information
loss, releases ~292KB of pure redundancy from `legacy/`.

## Deferred / parked

- G12 (Augment rule-file injection from `legacy/CLAUDE.md` and
  `agents/coding-01/AGENTS.md`) — tooling concern, not a SPEC decision;
  to be addressed in §5 when new project rules graduate.
- G2 (Phase / milestone labelling) and G8 (CLI surface) — expected to
  collapse once DP-1 and DP-4 are settled; revisit only if they don't.

## Knowledge gaps referenced this round

_None yet._ New entries go to `docs/spec-knowledge-gaps.md` when they
arise.
