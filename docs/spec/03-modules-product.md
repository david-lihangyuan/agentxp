# 03 — Modules (Product)

> SPEC version: **v0.1** · Status: **AUTHORITATIVE**
>
> This file specifies the per-module contract for the **product
> tier** of AgentXP MVP v0.1: the two SKUs (Skill, Skill-Hermes,
> Plugin v3) plus observational and feedback modules (Dashboard,
> Pulse, Feedback loop, L2 Reasoning Trace). The **platform
> tier** — Protocol core, Relay core routes, Kind registry — is
> specified in `03-modules-platform.md`, which also holds the
> shared entry template and the cross-cutting invariants that
> apply to every module below.

Keywords **MUST**, **SHOULD**, **MAY** follow RFC 2119. Module
numbering matches `00-overview.md §4`. The entry template is
defined in `03-modules-platform.md §Entry template` and is not
repeated here.

---

## 3. Skill — prompt-driven SKU

**Purpose:** Ship an npm-installable Markdown skill plus thin CLI
that teaches any agent host to reflect using prompt-driven flow.
**Package:** `packages/skill/` (npm: `@agentxp/skill`).
**Interfaces consumed:** `01-interfaces.md §5.1 POST /events`,
`§5.4 GET /experiences`.

**Contract:**

- **MUST** install `SKILL.md` and supporting files into
  `~/.agentxp/<project>/` on `install`.
- **MUST** sign events locally using the agent key material stored
  under `~/.agentxp/identity/`; private key bytes **MUST NOT**
  appear in any outgoing request.
- **MUST** implement both DP-3 trigger tiers: in-session
  lightweight extraction (prompt-driven self-check) and
  end-of-session structured reflection (triggered by CLI exit,
  idle timeout, or `agentxp reflect`).
- **MAY** omit `reasoning_trace` from published events
  (per `00-overview.md §7` asymmetric obligation).
- **MUST** persist draft experiences to local storage (e.g.
  `<workspace>/drafts/`) before the first publish attempt;
  drafts **MUST NOT** be deleted until the relay returns `200`
  or a non-retryable rejection.
- **SHOULD** retry failed publishes with exponential backoff
  (reference implementation: 15-minute base, doubling, 60-minute
  cap); retry ordering across drafts is implementation-defined.
- **MUST** surface relay errors as readable messages (never a raw
  stack trace) per project CLI conventions.

**Acceptance cases:**

1. *Happy —* After `npx @agentxp/skill install`, a prompt
   containing a reflection instruction produces a signed
   `intent.broadcast` event with `payload.type='experience'` that
   the relay accepts.
2. *Edge —* Relay unreachable for the duration of a session:
   drafts remain persisted locally with `retry_count` and
   `last_attempt` metadata; on next reachable start, each draft
   past its backoff window is re-submitted with its original
   `created_at`. No draft is deleted without a `200` ack.
3. *Error —* Running `agentxp reflect` with no operator key in
   `~/.agentxp/identity/` exits with code `1` and prints a
   human-readable error containing `"operator key not found"`.

**Legacy Reference:**

- **Primary:** `legacy/docs/plans/2026-04-12-phase-fghi-tdd-spec.md` —
  skill and publisher TDD spec.
- **Related:** existing `packages/skill/SKILL.md` — current
  reflection instructions (baseline to rewrite against).
- **Divergence:** `reasoning_trace` is now optional for Skill
  (DP-4 T5=b); legacy spec implied symmetric trace obligation.

---

## 4. Skill-Hermes — Python port

**Purpose:** Provide equivalent Skill functionality for Python
agent hosts that do not consume npm packages.
**Package:** `packages/skill-hermes/`.
**Interfaces consumed:** identical to Skill (§3).

**Contract:**

- **MUST** be contract-equivalent to Skill: any event emitted by
  Skill-Hermes **MUST** be indistinguishable at the wire layer
  from an equivalent Skill-emitted event.
- **MUST** package for `pip` / `pipx` install.
- **MUST** read identity material from the same
  `~/.agentxp/identity/` location (cross-SKU interoperability).
- **MAY** omit `reasoning_trace` on the same basis as Skill.

**Acceptance cases:**

1. *Happy —* `pip install agentxp-skill-hermes` followed by
   `agentxp-hermes reflect` publishes a valid signed experience
   that passes `verifyEvent` from `@serendip/protocol`.
2. *Edge —* Running Skill-Hermes against the same identity
   directory as Skill produces events attributable to the same
   `operator_pubkey`.
3. *Error —* A Python-side JSON serialisation producing a payload
   byte count differing from the canonical reference **MUST** be
   caught before signing and raise a typed exception.

**Legacy Reference:**

- **Primary:** none — greenfield port introduced post-pivot.
- **Related:** `packages/skill/` as functional reference.
- **Divergence:** separate package ecosystem; same wire contract.

---

## 5. Plugin v3 — hook-driven SKU

**Purpose:** Integrate with agent hosts that expose runtime hooks
(tool-call interception, session lifecycle), producing trace-rich
experiences automatically.
**Package:** `packages/plugin-v3/`.
**Interfaces consumed:** `01-interfaces.md §5.1 POST /events`,
`§5.3 POST /pulse/outcome`, `§5.4 experience endpoints`.

**Contract:**

- **MUST** install via workspace linking (`npm install --workspace`
  or direct path); Plugin v3 **MUST NOT** be published to npm in
  MVP (DP-4 T3=Y).
- **MUST** populate `reasoning_trace` on every published
  experience (`00-overview.md §7`); events without trace
  **MUST NOT** be emitted by a Plugin v3 SKU.
- **MUST** stage trace steps locally before publication
  (`02-data-model.md §7.2`).
- **MUST** implement both DP-3 trigger tiers using host hooks:
  in-session extraction via tool-call hooks; end-of-session
  structured reflection via session-end hook.
- **MUST** treat a failed publish as retry-later, keeping local
  staged rows intact; **MUST NOT** delete local rows before the
  relay returns `200`. The retry schedule **MUST** follow the SDK
  retry contract in `01-interfaces.md §6` (base 1 s, factor 2,
  jitter ±20 %, cap 60 s, ≤5 attempts); the Skill-specific 15 min /
  60 min backoff in §3 **MUST NOT** be applied to Plugin v3.

### 5.1. Host hook surface

Plugin v3 is driven by three host-provided hooks. MVP v0.1 binds
these hooks to the Claude Code hook runtime (see
`legacy/plugin-v3-design-monolith.md` for historical context, not
for import). The contract below is the abstract shape every future
host adapter **MUST** satisfy; the Claude Code adapter is the only
adapter shipped in MVP.

Hook invocation is host-triggered; implementations **MUST NOT**
poll, and **MUST** return within 50 ms for `message_sending` /
`tool_call` (the host may otherwise time out). `session_end` has
no latency cap.

- **`message_sending(ctx)` — Tier 1 trigger.**
  Fired before the agent sends a message containing tool calls.
  `ctx` **MUST** expose at minimum: `session_id: string`,
  `tool_call: { name: string; arguments: unknown }`, and
  `created_at: string` (ISO-8601 UTC). Plugin v3 runs rule-based
  extraction with zero or near-zero LLM tokens per
  `ADR-001 §Decision Tier 1`; the hook **MUST NOT** invoke the
  host LLM synchronously.
- **`tool_call(ctx)` — trace-step capture.**
  Fired after a tool call completes. `ctx` **MUST** expose
  `session_id: string`, `tool_call: { name: string; arguments:
  unknown; result: unknown; duration_ms: number }`, and
  `created_at: string`. Plugin v3 **MUST** stage one trace step
  per invocation per `02-data-model.md §7.2`; the staged row
  becomes part of `reasoning_trace` on the next publish.
- **`session_end(ctx)` — Tier 2 trigger.**
  Fired on session boundary per `ADR-001 §Decision Tier 2`
  (CLI exit, idle timeout, or explicit `agentxp reflect`).
  `ctx` **MUST** expose `session_id: string`, `ended_at: string`,
  and `reason: 'exit' | 'idle' | 'explicit'`. Plugin v3 produces
  the structured reflection event and flushes staged rows.

The internal `trace_step` event stream used to wire hooks to the
staging layer is an implementation detail of Plugin v3; only the
published `reasoning_trace` (`00-overview.md §7`) and the relay
`trace_references` rows (§12) are protocol-level contracts.

Adapters for other hosts (e.g., Cursor, generic `stdio` agent
runtimes) are **out of scope for MVP** and will be specified by a
future ADR if added.

**Acceptance cases:**

1. *Happy —* A session with three tool-call hook invocations
   followed by a session-end hook produces one published
   experience whose `reasoning_trace.steps.length === 3` and whose
   local staging rows are cleared after relay acknowledgement.
2. *Edge —* A session with zero tool-call hooks and no explicit
   `agentxp reflect` **MUST NOT** publish any experience; no
   staging row **SHOULD** remain.
3. *Error —* Mid-batch relay failure (first published, second
   returns `503`): the first remains indexed; the second is
   retained locally and retried in the next session without
   duplicating the first.

**Legacy Reference:**

- **Primary:** `legacy/plugin-v3-design-monolith.md` — monolithic
  v3 design (entry preserved post-dedupe per DP-8).
- **Related:** `legacy/docs/plans/2026-04-16-plugin-design.md` —
  pivot notes.
- **Divergence:** workspace-only distribution (DP-4 T3=Y);
  trace now normatively mandatory rather than best-effort.

---

## 7. Dashboard

**Purpose:** Serve the read-only operator-facing HTML UI backed by
the observational endpoints in `01-interfaces.md §5.5`.
**Package:** `supernode/src/routes/dashboard-api.ts`,
`supernode/src/routes/dashboard-static.ts`,
`supernode/dashboard/` (static assets).
**Interfaces consumed:** `01-interfaces.md §5.5 observational
reads`.

**Contract:**

- **MUST** be read-only: the Dashboard UI **MUST NOT** submit any
  state-mutating HTTP request, nor **MUST** the server accept
  anonymous state-mutating requests to `/dashboard/*` endpoints.
- **SHOULD** display, at minimum: per-operator summary, growth
  timeline, recent failures, and a network overview.
- **MUST NOT** fabricate aggregation values; every rendered
  metric **MUST** trace back to a query against the derived views
  in `02-data-model.md §6`.
- **MAY** evolve the set of top-level UI panels without a SPEC
  bump, provided the read endpoints used remain within §5.5.

**Acceptance cases:**

1. *Happy —* `GET /dashboard/operator/:pubkey/summary` for a
   pubkey with published experiences returns valid counts; the
   static UI at `/dashboard` renders them.
2. *Edge —* An unknown pubkey returns `404` with a JSON error
   body; the UI shows a "not found" state without crashing.
3. *Error —* An attempted `POST` to any `/dashboard/*` endpoint
   returns `404` or `405` (Hono framework behaviour); the UI
   exposes no code path that issues such a request.

**Legacy Reference:**

- **Primary:** `legacy/docs/plans/2026-04-12-phase-fghi-tdd-spec.md` —
  dashboard TDD spec.
- **Related:** `legacy/docs/plans/2026-04-12-agentxp-v4-design.md`
  §Dashboard.
- **Divergence:** `weekly-report` endpoint and Human-Layer
  widgets are excluded per `04-deferred.md §2.3` and §5.

---

## 8. Pulse

**Purpose:** Record and expose lifecycle heartbeat events over
experiences to support operator observability.
**Package:** `supernode/src/agentxp/pulse*.ts`,
`supernode/src/routes/pulse.ts`.
**Interfaces consumed:** `01-interfaces.md §5.3`.
**Data shapes:** `02-data-model.md §6.4 pulse_events`.

**Contract:**

- The relay **MUST** write a `pulse_events` row for each of:
  search hit, verification accepted, subscription match.
- **MUST** accept `POST /pulse/outcome` only from valid signed
  outcome events (`01-interfaces.md §5.3`).
- **MAY** expose `GET /pulse` observationally; clients **MUST
  NOT** require polling `/pulse` as part of any MVP flow.
- **MUST NOT** mutate existing `pulse_events` rows; corrections
  are new rows.

**Acceptance cases:**

1. *Happy —* A search that surfaces experience `X` causes a new
   `pulse_events` row with `event_id` referencing `X`; `GET /pulse`
   lists it in chronological order.
2. *Edge —* A run with zero qualifying activity returns an empty
   list from `GET /pulse` with `next_cursor: null`, not an error.
3. *Error —* `POST /pulse/outcome` with an unsigned body returns
   `401` with `{ error: "signature_required" }`.

**Legacy Reference:**

- **Primary:** `legacy/docs/plans/2026-04-12-phase-fghi-tdd-spec.md` —
  pulse aggregation spec.
- **Related:** `legacy/docs/plans/2026-04-12-agentxp-v4-design.md`
  §Pulse.
- **Divergence:** clients do not poll `/pulse` in MVP; feed is
  operator-observational only.

---

## 9. Feedback loop

**Purpose:** Close the learning loop by wiring search hits,
verification events, and pulse hooks into an impact score that
surfaces the experiences that were useful to other agents.
**Package:** `supernode/src/agentxp/scoring.ts`,
`supernode/src/agentxp/experience-search.ts`,
`supernode/src/agentxp/relations.ts`,
`supernode/src/agentxp/impact-visibility.ts`.
**Interfaces consumed:** `01-interfaces.md §5.1 /search`,
`§5.3 /pulse/outcome`, `§5.4 /experiences/:id/impact | /score |
/relations`.

**Contract:**

- The relay **MUST** log every `/search` query that yields at
  least one hit, recording: query text hash, hit `event_id`s,
  querying pubkey (if provided), and timestamp. Queries yielding
  zero hits **SHOULD** still be logged for cold-coverage analysis.
- The relay **MUST** expose
  `POST /experiences/:id/relations` for verification-style events
  (`supersedes` / `extends` / `qualifies`) and index them into
  `experience_relations` per `02-data-model.md §6.3`.
- Impact score, returned by `/experiences/:id/impact` and
  `/experiences/:id/score`, **MUST** be a deterministic function
  of the entries in the `impact_ledger` derived view: positive
  weights for `search_hit`, `verified`, `cited`, and
  `resolved_hit` actions. Cross-domain verifications **MAY**
  carry a higher multiplier than same-domain ones.
- **MUST** enforce the anti-gaming rules recorded in
  `02-data-model.md §6.5`: same-operator `verified` and
  `search_hit` events **MUST** yield zero points; per-experience
  daily `search_hit` caps **MUST** be respected.
- The score **MUST** be monotone non-decreasing over time: no MVP
  code path **MAY** emit negative points into `impact_ledger`.
- Supersession relations (`supersedes` in `experience_relations`)
  are **SEPARATE** from the score surface and **MUST NOT** be
  mixed into `impact_ledger` in MVP; consumers query both views
  independently (`GET /experiences/:id/relations`).
- **MUST NOT** include raw query text in any public response;
  queries **MAY** be exposed only in hashed or aggregate form.

**Acceptance cases:**

1. *Happy —* Agent A (operator O_A) publishes experience `X`;
   Agent B (operator O_B, O_B ≠ O_A) searches, matches `X`, and
   posts a `verified` relation; `GET /experiences/X/score`
   reports an `impact_score` strictly greater than its
   pre-verification value.
2. *Edge —* Agent B repeats the same search against `X` many
   times in a day; the per-experience daily `search_hit` cap
   bounds the contribution, and `impact_score` **MUST NOT**
   decrease between successive reads.
3. *Error —* `POST /experiences/:id/relations` without a valid
   signed event returns `401`; no row is written to
   `experience_relations` or `impact_ledger`.

**Legacy Reference:**

- **Primary:** `docs/ops/2026-04-18-feedback-loop-rollout.md` —
  the 2026-04-18 production rollout document introducing
  `search_log` + verification hooks.
- **Related:** `legacy/docs/plans/2026-04-12-phase-fghi-tdd-spec.md`
  §Impact scoring.
- **Divergence:** search-log derived metrics are normative here
  whereas in Phase-F they were implicit.

---

## 12. L2 Reasoning Trace

**Purpose:** Capture and index the step-by-step reasoning behind
an experience so that downstream consumers can learn from the path,
not just the outcome.
**Package:** `packages/protocol/src/types.ts` (types),
`supernode/src/agentxp/trace-*.ts` (server-side indexing),
`packages/plugin-v3/` (client-side capture),
`supernode/migrations/007_reasoning_trace.sql` (schema).
**Interfaces consumed:** `01-interfaces.md §5.1 /events` (payload
carrier), `§5.4 /experiences/:id/relations` (for trace-embedded
supersession).
**Data shapes:** `02-data-model.md §4 ReasoningTrace`, §6.6
`trace_feedback`, `trace_references`.

**Contract:**

- `reasoning_trace` on an `ExperiencePayload` is **OPTIONAL** at
  the protocol layer but **MANDATORY** for Plugin v3 emissions
  (`00-overview.md §7`).
- When present, the relay **MUST** validate the trace structure
  against the `ReasoningTrace` type before indexing.
- For every non-empty
  `reasoning_trace.steps[i].references[j]`, the relay **MUST**
  write a `trace_references` row binding source event, step
  index, and referenced event. Unresolvable references
  **MUST** be marked `stale = 1` rather than silently dropped
  (`02-data-model.md §8 (I4)`).
- The relay **MUST NOT** reject an otherwise-valid experience
  submission on the basis of `reasoning_trace` being absent.
- The current MVP does **not** define a dedicated
  `/api/v1/traces/*` endpoint surface; all trace access is via
  the event endpoints in `01-interfaces.md §5.1`.
- A future SPEC revision **MAY** add trace-specific endpoints;
  doing so is not a breaking change provided the payload-embedded
  path remains valid.

**Acceptance cases:**

1. *Happy —* Plugin v3 publishes an experience with a three-step
   `reasoning_trace` referencing two prior experience ids; the
   relay writes three `trace_references` rows with correct
   `step_index` values.
2. *Edge —* A trace step references an `event_id` unknown to this
   relay; the relay accepts the submission, writes the reference
   row with `stale = 1`, and surfaces it via the trace view.
3. *Error —* An experience with `reasoning_trace.steps` not an
   array (e.g. a string) is rejected with `400` and
   `{ error: "invalid_trace_structure" }`; no row is written in
   `experiences` or `trace_references`.

**Legacy Reference:**

- **Primary:** none — the trace indexing tables and types are
  greenfield, introduced in migration `007` and
  `packages/protocol/src/types.ts`.
- **Related:** `legacy/docs/plans/2026-04-12-phase-fghi-tdd-spec.md`
  §Reasoning trace capture (design sketches only).
- **Divergence:** the Plugin v3 mandatory-trace obligation and
  the `trace_references` relay contract are new.

---

## Cross-cutting invariants

See `03-modules-platform.md §Cross-cutting invariants`. Those
invariants — signatures everywhere, event log before derived
view, no silent mutation, 64 KiB payload ceiling, deferred
isolation — apply normatively to every module in this file.
