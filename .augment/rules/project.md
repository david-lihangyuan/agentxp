# AgentXP — Project rules

Canonical long-term rules for this repository. These are loaded
automatically by the AI assistant on every session (see
`.augment/rules/`). User instructions in a given conversation
override these rules when they conflict.

## 1. Documentation layers (physical separation)

- `docs/spec/` — **AUTHORITATIVE**. The only path code under
  `packages/` MAY reference for behavioural contracts.
- `docs/ops/` — Operational runbooks. MAY be referenced by SPEC
  `Legacy Reference` fields; not a contract source.
- `docs/adr/` — Architecture Decision Records. Every decision that
  diverges from or refines the SPEC lands here.
- `legacy/` — Historical snapshots. **Read-only reference only.**
  One exception: `legacy/docs/spec/serendip-protocol-v1.md` is still
  normative per `HISTORY.md §1`. Cite it by filename:line; do not
  move or edit it.
- `legacy/src-v1/` — Pre-SPEC source snapshot. **MUST NOT be
  imported** from `packages/`. See `legacy/src-v1/README.md`.

## 2. Rules of engagement

- Code under `packages/` MUST only import from `packages/` or declared
  npm dependencies. Importing from `legacy/src-v1/` is a project-level
  error (enforced by `scripts/check-no-legacy-imports.sh`).
- SPEC module entries (`docs/spec/03-modules-{platform,product}.md`)
  name each package by its logical workspace name, e.g.
  `packages/openclaw-plugin/`. Per
  [ADR-005](../../docs/adr/ADR-005-flatten-packages-root.md) (which
  superseded ADR-002), these resolve on disk to literally
  `packages/<name>/` at the repo root. The npm workspaces root glob
  is `packages/*`; the npm name is `@agentxp/<name>` unless a SPEC
  module specifies otherwise.
- When implementing a module documented in
  `docs/spec/03-modules-{platform,product}.md`, the `Legacy Reference`
  field identifies the relevant legacy source. Algorithmic porting
  is allowed; direct import is not. Cite ported algorithms as
  `// Ported from legacy/src-v1/<path>:<line-range>`.
- Every new decision that diverges from or refines the SPEC requires
  an ADR in `docs/adr/`. Provisional / AI-recommended defaults MUST
  carry a `Status: PROVISIONAL` header and a `Revisit triggers`
  section.
- Every new kind added to the Serendip protocol requires a PR that
  touches both `kind-registry/` and `docs/spec/01-interfaces.md`
  (or `02-data-model.md`).

## 3. Legacy policy

- Files under `legacy/` are preserved byte-for-byte except for
  byte-identical dedupe (see `HISTORY.md §6`, DP-8).
- `HISTORY.md` is the canonical index mapping `legacy/` -> SPEC.
- Re-entering a deferred module follows the gate defined in
  `docs/spec/04-deferred.md §6`.
- When a `packages/` file would benefit from reading a legacy
  algorithm, always read the legacy file first, then write the new
  implementation from scratch against the SPEC contract. Do not
  copy-paste.

## 4. Workflow skills to prefer

When an applicable skill exists, load it before acting. Defaults:

- **superpowers** (via `~/.superpowers/bin/sp read <name>`):
  `test-driven-development`, `verification-before-completion`,
  `writing-plans`, `executing-plans`, `systematic-debugging`,
  `requesting-code-review`.
- **agent-skills** (via `cat ~/.agent-skills/skills/<name>/SKILL.md`):
  `planning-and-task-breakdown`, `incremental-implementation`,
  `code-review-and-quality`, `documentation-and-adrs`.
  `spec-driven-development` is already satisfied by `docs/spec/`;
  load it only when extending the SPEC, not re-deriving it.

## 5. Bootstrap graduation

This project has **graduated from BOOTSTRAP** as of
commit `f4bd032` (archive pre-SPEC src to legacy/src-v1/). From this
point:

- `docs/archive/BOOTSTRAP.md` is retained for reproducibility only;
  do not re-run its flow.
- The SPEC under `docs/spec/` is the ground truth.
- Implementation proceeds per `docs/archive/BOOTSTRAP.md §4.2` (TDD
  against SPEC + `Legacy Reference` in `packages/`).
