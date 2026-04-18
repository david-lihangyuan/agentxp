# legacy/src-v1/ — Pre-SPEC source snapshot

Snapshot taken on 2026-04-18, archived via git mv on top of commit 58fef3cd2d47a4bbf4a224fd5531a5cbe6b1c259
(the SPEC delivery commit). The v0.1 SPEC under `docs/spec/` is implemented
from scratch in `src/` per BOOTSTRAP §4.3 (integral rewrite).

## Contents

- `packages/`  — pre-SPEC workspace packages (plugin-v3, skill, shared libs)
- `supernode/` — pre-SPEC relay / router service (includes the Human Layer
                path marked for physical removal per `docs/spec/04-deferred.md §5`)
- `scripts/`   — development scripts
- `tests/`     — pre-SPEC integration tests
- `agents/`    — experience contribution bots (mostly gitignored; preserved
                on disk for reference)

## Rules

- MUST NOT be imported by anything under `src/`. A build-time check enforces
  this (see `.augment/rules/project.md §2`).
- MUST NOT be edited; treat as read-only.
- MAY be cited by filename:line in `src/` comments when an algorithm or
  invariant is ported over, e.g.
  `// Algorithm ported from legacy/src-v1/supernode/scoring.ts:42-78`.
- Deletion deferred until v0.1 ships AND an ADR confirms no remaining
  references exist.

## Mapping to SPEC modules

Each MVP module in `docs/spec/03-modules-{platform,product}.md` carries a
`Legacy Reference` field pointing to the relevant files in this tree.
See `HISTORY.md §2` for the module-level index.
