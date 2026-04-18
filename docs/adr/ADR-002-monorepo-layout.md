# ADR-002 — Monorepo on-disk layout (provisional)

- Date: 2026-04-18
- Status: **PROVISIONAL** (closes §4.1 check GAP-1; adopted 2026-04-18)
- Related: `.augment/rules/project.md §1-§2`; `docs/spec/00-overview.md §4`;
  `docs/spec/03-modules-{platform,product}.md` per-module `Package:` fields
- Supersedes: —

## Context

BOOTSTRAP §4.1 executability check (`/.spec-v41-check/A-output.md §5`)
surfaced a path conflict between two authoritative documents:

- `docs/spec/03-modules-*.md` names each package by logical name, e.g.
  `packages/plugin-v3/`, `packages/skill/`, `packages/protocol/`.
- `.augment/rules/project.md §1-§2` declares that new code MUST live under
  `src/` and MUST only import from `src/` or npm dependencies.

Neither document states whether SPEC's `packages/<pkg>/` is a literal root
path or a logical workspace name rooted inside `src/`. The fresh §4.1
session flagged this as an ambiguity and assumed `src/packages/<pkg>/`;
this ADR ratifies that assumption so every SPEC module maps to an
unambiguous on-disk location before §4.2 implementation starts.

## Decision

The repository uses an npm workspaces monorepo rooted at `src/`.

1. **On-disk location.** Every package named in SPEC as
   `packages/<name>/` physically lives at `src/packages/<name>/`.
   Example: `packages/plugin-v3/` → `src/packages/plugin-v3/`.
2. **Workspace manifest.** Root `package.json` declares
   `"workspaces": ["src/packages/*"]`. No package lives outside
   `src/packages/` in MVP v0.1.
3. **npm names.** Packages are published (or workspace-linked) under
   `@agentxp/<name>` unless a SPEC module explicitly states otherwise.
   Example: `@agentxp/plugin-v3`, `@agentxp/skill`, `@agentxp/protocol`.
4. **Import origin.** `project.md §2` "code under `src/` MUST only
   import from `src/` or declared npm dependencies" is unchanged; this
   ADR only clarifies where SPEC package names resolve on disk.
5. **Supernode exception.** `supernode/src/...` paths in SPEC remain
   logical names. Supernode is a single workspace package whose on-disk
   location is `src/packages/supernode/`; SPEC references such as
   `supernode/src/routes/dashboard-api.ts` resolve to
   `src/packages/supernode/src/routes/dashboard-api.ts`.
6. **SPEC wording is authoritative, paths are addressing.** When SPEC
   and this ADR appear to disagree on a path, SPEC names win as the
   contract identity; this ADR resolves the addressing. A SPEC update
   that renames a package requires the corresponding directory move.

## Provenance flag

This decision was **not authored by the project lead**. It is the
minimal reading that reconciles two pre-existing documents without
re-opening DP-4 (SKU packaging). It is PROVISIONAL and MAY be revised
without a supersession ADR — update this ADR's `Status` field and
`Revisit triggers` list instead. A new ADR (ADR-00N, "Supersedes:
ADR-002") is only required when the monorepo shape itself changes
(e.g., splitting into multiple repos, moving `src/` out of the
workspace root, or flattening `src/packages/` away).

## Revisit triggers

Revisit this decision when any of the following becomes true:

1. A second repository is introduced and packages need to split across
   repos; the "single monorepo at `src/`" premise no longer holds.
2. A package appears that genuinely belongs outside `src/packages/`
   (e.g., a build-tools package distributed separately from the MVP
   surface).
3. npm workspaces proves structurally insufficient (e.g., we migrate
   to `pnpm` or `nx` and the directory glob needs to change).
4. The project lead reopens the question during any session.

## Consequences

- Root `package.json` "workspaces" field is set to
  `["src/packages/*"]` in the first `feat/v0.1-impl` commit (this
  closes §4.1 GAP-5).
- Every SPEC module entry in `03-modules-*.md` whose `Package:` line
  reads `packages/<name>/` is understood to mean
  `src/packages/<name>/`; no bulk SPEC rewrite is required.
- Ported algorithm citations per `project.md §2` continue to use the
  legacy literal path (`// Ported from legacy/src-v1/...`). This ADR
  does not affect how legacy is referenced.
- Tooling (tsconfig path mappings, build scripts, import lint rules)
  is configured against `src/packages/*` from day one of §4.2.
