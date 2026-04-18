# ADR-001 — Reflection trigger mechanism (provisional)

- Date: 2026-04-18
- Status: **PROVISIONAL** (AI-recommended default, adopted 2026-04-18)
- Related: DP-3 in `docs/spec-in-progress.md`;
  DP-4 Module #3 & #5 in `docs/spec/03-modules-product.md`
- Supersedes: —

## Context

BOOTSTRAP §3 DP-3 required a decision on when a reflection is captured
in both SKUs (Skill and Plugin v3). The project lead declared
"not clearly familiar" with the trade-offs per BOOTSTRAP §3 C-track
and accepted the AI-recommended default rather than authoring the
decision directly.

Three candidates were considered:

- **A** — Task-level trigger: fire at the boundary of each task.
  Rejected because "task boundary" is ill-defined for open-ended
  conversational agents.
- **B** — Session-only trigger: fire once at the end of a session.
  Rejected because it loses the in-session signal that both today's
  Skill and Plugin rely on.
- **C** — Hybrid, two-tier. Adopted.

## Decision

Both SKUs MUST implement a **two-tier trigger**; the mechanism differs
per SKU per DP-1.

**Tier 1 — In-session (lightweight, rule-based):**

- Skill: the `SKILL.md` prompt instructs the agent to self-check
  every ~5 tool calls and extract candidate reflections inline.
- Plugin v3: the `message_sending` hook applies rule-based
  extraction with zero or near-zero LLM tokens.

**Tier 2 — End-of-session (structured):**

- Session boundary is defined as CLI exit, idle timeout, or explicit
  invocation of `agentxp reflect` (contract to be sharpened in
  `docs/spec/01-interfaces.md`).
- Produces a structured reflection event; both SKUs share the same
  event schema per DP-5.

This aligns with the Tier 1 / Tier 2 distinction already documented
in `legacy/docs/plans/2026-04-12-agentxp-v4-design.md §5.6`.

## Provenance flag

This decision was **not authored by the project lead**. It is
PROVISIONAL and MAY be revised at any time without requiring an ADR
supersession — update this ADR's `Status` field and the
`Revisit triggers` list instead. A new ADR (ADR-00N, "Supersedes:
ADR-001") is only required when a structurally different trigger
model is adopted (e.g., pure session-only, or task-level).

## Revisit triggers

Revisit this decision when any of the following becomes true:

1. Either SKU observes >10% discrepancy between Tier-1 and Tier-2
   captured reflections on the same task class (i.e., one tier misses
   material content the other catches).
2. Tier-2 is shown to produce <50% of total reflections on
   representative sessions, implying it is redundant against Tier-1.
3. Token / latency cost of Tier-1 exceeds the provisional budget once
   measured (budget TBD in a follow-up ADR after the first
   telemetry pass).
4. The project lead reopens the question during any session.

## Consequences

- `docs/spec/01-interfaces.md` specifies the `agentxp reflect`
  command and the session-boundary contract.
- `docs/spec/03-modules-product.md §3` (Skill) and §5 (Plugin v3)
  both reference this ADR and embed the two-tier contract in their
  acceptance criteria.
- `docs/spec/05-glossary.md` defines "session boundary" precisely.
- Trace obligations (DP-4: Skill / Plugin asymmetric) are orthogonal
  to this decision; both tiers must emit trace events where required.
