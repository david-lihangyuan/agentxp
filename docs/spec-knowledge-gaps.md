# Knowledge Gaps

> Ledger of concepts the project lead flagged as unfamiliar during the
> BOOTSTRAP §3 Step 2 dialogue. Not a blocker for SPEC generation:
> decisions can accept an AI recommendation marked "provisional default"
> and be revisited later. This file is for transparency, so nothing
> proceeds under the fiction that "the user decided it".

## Reflection trigger timing (task-level / session-level / hybrid)

- Why it matters: decides how often the agent pauses to record a
  reflection, how many reflections per day get produced, how noisy the
  `reflection/` files get, and what a fair cost expectation is for the
  user (extra LLM tokens per pause). Affects DP-3; cascades into
  interface contracts for both SKUs in `03-modules-product.md`.
- 1-minute plain-language explanation: think of a person journalling.
  Task-level = write an entry every time you finish one thing.
  Session-level = write only once at the end of the day. Hybrid = take
  small mental notes as things happen and write a proper journal
  entry at end of day. The question is which of these the SPEC tells
  both Skill and Plugin to implement.
- Depth resources:
  - `legacy/docs/plans/2026-04-12-agentxp-v4-design.md` §5 (the
    reflection framework as designed)
  - `legacy/docs/plans/2026-04-16-plugin-design.md` §3 (what the Plugin
    actually does at each hook)
  - `packages/skill/SKILL.md` lines 38-53 (what the Skill actually
    tells agents to do)
- Current state: **adopted AI default** (provisional). User took the
  recommendation of option C (hybrid) on 2026-04-18 after declaring
  unfamiliarity with the concept. ADR to be written in Step 3
  recording this explicitly. Revisit permitted anytime.
- Decisions impacted: DP-3 (settled provisionally); flows into DP-4
  (MVP scope — "5+ tool call mid-task check" is now in) and DP-5
  (data truth source — more frequent reflections mean more local
  writes).
