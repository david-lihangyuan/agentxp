# ADR-004 — Plugin v3 as shippable OpenClaw plugin

- Date: 2026-04-19
- Status: **ACCEPTED**
- Related: DP-1 & DP-4 T3 in `docs/spec-in-progress.md`;
  `docs/spec/03-modules-product.md §5`; legacy reference
  `legacy/src-v1/packages/plugin-v3/` (5358 LOC, 29 files);
  `legacy/src-v1/packages/plugin-v3/openclaw.plugin.json`.
- Supersedes: —
- Amends: DP-4 sub-decision T3 (scope change for post-MVP only; MVP v0.1
  contract at tag `mvp-v0.1.0` is **not** retroactively altered).

## Context

MVP v0.1 shipped `@agentxp/plugin-v3` as a **workspace-only TypeScript
library**: three pure hook-shaped functions (`onMessageSending`,
`onToolCall`, `onSessionEnd`), a local SQLite staging store, and an
HTTP publisher. DP-4 T3=Y explicitly deferred npm publish and any
OpenClaw-host integration: *"workspace-only install for MVP; npm
publish deferred"*.

At tag `mvp-v0.1.0` the package therefore:

- has no `openclaw.plugin.json` manifest;
- does not import or wire into `openclaw/plugin-sdk`;
- cannot be auto-loaded by any host plugin runtime;
- is marked `"private": true`, `publishConfig.access: restricted`.

The project lead raised on 2026-04-19 that the target is OpenClaw and
the distribution channel is npm + GitHub. This requires a scope
change relative to DP-4 T3=Y. Rather than amend the frozen MVP SPEC,
the project opens a new post-MVP phase (M7) that lifts the constraint
for the Plugin v3 package only.

## Decision

1. **Open a new milestone `M7 — Plugin v3 shippable as OpenClaw plugin`.**
   M7 is post-MVP; it does not change the behaviour or contract of
   anything shipped under the `mvp-v0.1.0` tag. `docs/MILESTONES.md`
   records M7 with verifiable checks.

2. **Target host: OpenClaw.** Peer dependency is `openclaw >= 2026.4.15`
   (current published version at decision time). The plugin binds via
   `definePluginEntry` from the `openclaw/plugin-sdk` subpath export.

3. **Distribution: npm public + GitHub.** The package transitions from
   `"private": true` / `publishConfig.access: restricted` to
   `publishConfig.access: public`. The SPEC §5 MUST-NOT-publish clause
   is scoped to MVP v0.1 by timestamp and superseded post-MVP by this
   ADR.

4. **Scope is split into two batches.** Batch 1 must land and publish
   before Batch 2 begins; Batch 2 may slip without holding Batch 1.

   **Batch 1 — adapter shell + full lifecycle hook surface.**
   - `src/packages/plugin-v3/openclaw.plugin.json` manifest.
   - `src/packages/plugin-v3/src/adapter.ts` entry that calls
     `definePluginEntry({ id: 'agentxp', register(api) { ... } })`.
   - Register all six SPEC-aligned hooks via `api.on(...)`:
     `session_start`, `session_end`, `message_sending`,
     `before_tool_call`, `after_tool_call` (current `onToolCall`),
     `agent_end`. Three of these (`session_start`,
     `before_tool_call`, `agent_end`) are new work in M7; the other
     three reuse the existing pure functions from M4.
   - Preserve the existing pure-function exports in `src/index.ts`
     for non-OpenClaw embedders; the adapter is additive.
   - npm publish contract: `name: "@agentxp/plugin-v3"`,
     `access: public`, `files: ["dist/", "openclaw.plugin.json",
     "README.md"]`.

   **Batch 2 — memory supplement injection.**
   - Port `legacy/src-v1/packages/plugin-v3/memory-corpus.ts` and
     `memory-prompt.ts` as new implementations against the SPEC §5
     contract; no direct import from `legacy/`.
   - Register via `api.registerMemoryCorpusSupplement(...)` and
     `api.registerMemoryPromptSupplement(...)`.
   - Phase-aware selection (stuck / evaluating / planning /
     executing). Input: current agent context; output: candidate
     experiences to inject into the prompt.

5. **Out of scope for both batches.** The following legacy capabilities
   are explicitly NOT ported:

   | Legacy module | LOC | Reason not ported |
   |---|---|---|
   | `onboarding.ts` | 691 | First-run workspace pattern scan; YAGNI for MVP-consumer install path. |
   | `service/*` (evolve tick, distiller, scoring, network-puller, publisher) | 768 | Obsoleted by relay-side scoring (SPEC DP-4 #9, already shipped in v0.1). Re-porting would contradict SPEC. |
   | `cluster.ts` + `quality-gate.ts` + `pattern-detector.ts` + `extraction.ts` | 599 | Client-side dedup / quality filtering; relay-side `trace_references` + scoring now handle the equivalent contract. |
   | `panel.ts` + Telegram delivery | 76 + embedded | Out-of-scope for an Agent SKU. |
   | `protocol/publisher.ts` (legacy WebSocket) | 110 | Contradicts SPEC DP-6 (HTTP-only). |
   | `migrate-v3.ts` | 174 | One-shot legacy DB migration, no longer relevant. |

   Aggregate: ~3000 LOC of legacy code stays in `legacy/` and is NOT
   migrated. Net migration budget for M7 is ~800 LOC of new code in
   `src/packages/plugin-v3/` + ~500 LOC of tests.

## Consequences

- `docs/spec/03-modules-product.md §5` **will NOT** be edited under M7;
  the MVP SPEC freeze holds. A post-MVP SPEC minor version may later
  update §5 to reflect shipped reality. Until then, ADR-004 is the
  canonical reference for Plugin v3's shipping state.
- `docs/MILESTONES.md` gains an M7 entry with verifiable Checks.
- `docs/openclaw-plugins.md` is created as a standing one-page ledger
  of AgentXP-authored OpenClaw plugins. Today: one entry (plugin-v3).
- Plugin v3 acquires an optional peer dependency on `openclaw`. At
  runtime, absence of the host is allowed (the pure-function export
  path remains usable); at install time, hosts provide `openclaw`
  themselves.
- First npm publish is a prerelease (`v0.2.0-rc.1` or similar); a
  stable `v0.2.0` follows only after a real OpenClaw install loads
  the plugin and Batch 1 smoke passes end-to-end against production
  relay.

## Rejected alternatives

- **Amend DP-4 T3 in `docs/spec-in-progress.md`.** Rejected because
  the MVP SPEC is tagged at `mvp-v0.1.0` and mutating the ledger that
  drove the tagged release pollutes the audit trail. An ADR is the
  cleaner vehicle for a post-MVP scope change.
- **Full port of the 5358-LOC legacy plugin.** Rejected: see the
  "Out of scope" table — roughly 3000 LOC would be re-porting
  obsolete or superseded behaviour.
- **Single-batch delivery (adapter + injection together).** Rejected
  because the adapter shell alone delivers the "it is an OpenClaw
  plugin" contract the user asked for, and is independently testable
  and releasable. Batch 2's memory injection is higher value but
  higher risk; separating them preserves optionality.

## Revisit triggers

- OpenClaw plugin SDK ships a breaking change in `definePluginEntry`
  or the `api.on(...)` surface.
- A second AgentXP-authored OpenClaw plugin is contemplated (promote
  `docs/openclaw-plugins.md` from a flat ledger to a real
  sub-directory).
- Relay-side scoring ceases to cover the contract currently served by
  the un-ported legacy `service/scoring.ts` (then reconsider local
  scoring for the "offline-first" path per DP-5).
