# ADR-005 — Flatten monorepo to `packages/` at repo root

- Date: 2026-04-21
- Status: **ACCEPTED**
- Supersedes: [ADR-002](./ADR-002-monorepo-layout.md)
- Related: `.augment/rules/project.md §1-§2`;
  `docs/spec/03-modules-{platform,product}.md` per-module `Package:`
  fields (unchanged — see point 3 below)

## Context

ADR-002 placed every package at `src/packages/<name>/` and kept the
`src/` directory as a logical "code root" under which all current work
was required to live. Its own Provenance flag explicitly listed
"flattening `src/packages/` away" as a structural change that requires
a new ADR rather than an in-place edit.

Since ADR-002 was written, two observations made `src/` redundant:

1. `src/` contained exactly one child, `src/packages/`. No other code,
   config, or build output ever lived at `src/`. The directory
   contributed nothing but a level of nesting.
2. Every SPEC module entry in `docs/spec/03-modules-*.md` already names
   its package as `packages/<name>/`. ADR-002's re-addressing step
   (`packages/<name>/` → `src/packages/<name>/`) forced every reader to
   do a mental substitution on every SPEC reference.

## Decision

The repository is flattened so that packages live at the repo root.

1. **On-disk location.** Every package named in SPEC as
   `packages/<name>/` now physically lives at `packages/<name>/`,
   matching the SPEC text byte-for-byte. No substitution needed.
2. **Workspace manifest.** Root `package.json` declares
   `"workspaces": ["packages/*"]`.
3. **SPEC is unchanged.** `docs/spec/03-modules-*.md` already uses the
   `packages/<name>/` form. This ADR makes that form literal on disk.
4. **`src/` directory is removed.** The historical `src/packages/`
   path no longer exists. The one piece of tooling that referenced it
   (`scripts/check-no-legacy-imports.sh`) is updated to check
   `packages/` instead.
5. **Import origin rule is preserved, reworded.** `project.md §2` now
   says "code under `packages/` MUST only import from `packages/` or
   declared npm dependencies". The policy is unchanged; only the path
   root name differs.
6. **npm names unchanged.** Packages remain `@agentxp/<name>` per the
   prior `refactor(naming): rename @serendip/* packages to @agentxp/*
   scope` commit.
7. **Legacy paths unchanged.** `legacy/src-v1/...` citations in
   ported-algorithm comments remain literal and continue to use the
   `src-v1` path (that directory still exists under `legacy/`).

## Consequences

- Root `package.json` `workspaces` glob changes from
  `["src/packages/*"]` to `["packages/*"]`.
- `scripts/check-no-legacy-imports.sh` changes its target directory
  from `src/` to `packages/`.
- Deploy scripts, CI workflows, smoke scripts, and documentation that
  hard-coded `src/packages/` are updated in the same commit.
- Python package `packages/skill-hermes/` updates docstring path
  references; no import changes (Python code already uses package
  imports, not filesystem paths).
- Historical records (`BOOTSTRAP.md`, `docs/releases/mvp-v0.1.0-pr.md`)
  retain the `src/packages/` form intentionally, because they are
  snapshots of what was written at the time.

## Revisit triggers

Revisit this decision when any of the following becomes true:

1. A second top-level source root is introduced (e.g., a `cli/`
   directory alongside `packages/` with its own build pipeline).
2. The project moves away from npm workspaces to a tool (nx, turbo,
   pnpm) whose conventional root glob differs.
3. SPEC starts naming packages with a different prefix (e.g.,
   `services/<name>/` or `apps/<name>/`) and the repo needs to follow.
