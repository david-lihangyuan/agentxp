# AGENTS.md

> Entry point for AI coding assistants working on this repository.
> Humans should start with [`README.md`](README.md) and
> [`CONTRIBUTING.md`](CONTRIBUTING.md).
>
> **This is the single source of truth for agent rules.** Tool-specific
> configs (`CLAUDE.md`, `.cursor/rules/`, `.augment/rules/`,
> `.github/copilot-instructions.md`, etc.) MUST NOT duplicate project
> rules — they should either reference this file or contain only
> tool-specific workflow details (e.g. how to invoke that tool's skill
> library). When in doubt, load the files linked below.

This file follows the [agents.md](https://agents.md/) convention. It
is intentionally short — a pointer index, not documentation. Load the
linked files on demand.

---

## 1. Authoritative sources (read before editing)

| Source | Role |
|---|---|
| [`docs/spec/`](docs/spec/) | **Ground truth** for all behavioural contracts. Code under `packages/` may reference this path only. |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records. Consult when a decision feels underspecified. |
| [`.augment/rules/project.md`](.augment/rules/project.md) | Long-form project rules (doc layers, legacy policy, engagement rules). Treat as normative. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch strategy, PR checklist, commit format, code style. |

When `.augment/rules/project.md` and this file disagree, the rules file wins.

---

## 2. Non-negotiable rules

1. **`legacy/` is read-only.** No file under `packages/` may import from
   `legacy/`. Enforced by `scripts/check-no-legacy-imports.sh` (runs in
   CI and as part of `npm run verify`). When an algorithm is ported
   from a legacy source, cite it as a comment:
   `// Ported from legacy/src-v1/<path>:<line-range>`.

2. **SPEC is upstream of code.** Divergence from `docs/spec/` requires
   an ADR in `docs/adr/` before the code change lands.

3. **Every release goes through Changesets.** If a PR changes published
   behaviour for `@agentxp/openclaw-plugin`, `@agentxp/protocol`,
   `@agentxp/skill`, or `@agentxp/supernode`, add a `.changeset/*.md`
   entry. Enforced by `.github/workflows/changeset-check.yml`. Release
   flow is documented in [`docs/RELEASING.md`](docs/RELEASING.md).

4. **Never edit generated files.** Skip `dist/`, `node_modules/`,
   `coverage/`, and `*.sqlite*`.

---

## 3. Commands you will actually need

All commands run from the repository root unless stated otherwise.

```bash
# One-shot quality gate — run before you claim anything is done.
npm run verify        # format:check + lint:no-legacy + typecheck + test

# Individual steps (when verify fails and you need to isolate)
npm run format:check  # Prettier dry-run
npm run format        # Prettier write (fix format failures)
npm run lint:no-legacy
npm run typecheck
npm test              # vitest (unit + characterization)

# End-to-end integration smoke (starts a real relay)
npm run smoke         # build + scripts/mvp-done-smoke.sh

# Python skill-hermes tests (optional, requires uv)
npm run test:hermes
```

CI runs the same `verify` on every PR (see `.github/workflows/pr.yml`).
The full mvp-done-smoke.sh also runs in CI for any PR touching
`packages/supernode/`, `packages/skill/`, `packages/openclaw-plugin/`,
or `scripts/`.

---

## 4. Workspace layout

```
packages/
  protocol/         @agentxp/protocol    — Serendip v1 signing, canonical event id
  skill/            @agentxp/skill       — Reflection Skill TS CLI
  skill-hermes/     agentxp-skill-hermes — Python port (PyPI not yet)
  openclaw-plugin/  @agentxp/openclaw-plugin — OpenClaw host integration
  supernode/        @agentxp/supernode   — Hono + SQLite relay (private)
kind-registry/      Reverse-DNS kind schemas (see §4 of .augment/rules/project.md)
docs/
  spec/             Authoritative v0.1 SPEC
  adr/              Architecture Decision Records
  ops/              Runbooks
  archive/          Historical / BOOTSTRAP-era docs, read-only
legacy/             Pre-SPEC snapshots, read-only (see §3 of project rules)
scripts/            smoke tests + one-off tooling
.changeset/         Pending release notes (auto-consumed by Changesets)
```

Workspace glob is `packages/*`. The directory name equals the logical
package name (e.g. `packages/openclaw-plugin/`); the npm name is
`@agentxp/<name>`. See [ADR-005](docs/adr/ADR-005-flatten-packages-root.md).

---

## 5. Testing conventions

- Framework: **vitest 4.x** (TypeScript, ESM).
- Location: `packages/<name>/tests/*.test.ts`.
- Shared relay + identity fixtures: import from
  `@agentxp/supernode/testing` (subpath export). Do not reach across
  package boundaries with relative paths.
- Test helpers that need typed HTTP: use `fetchJson<T>()` from
  `packages/<name>/tests/helpers.ts` — generic return type forces
  explicit response-shape annotation.

---

## 6. Commit and branch conventions

- **Branches**: `feature/…`, `fix/…`, `refactor/…`, `chore/…` off
  `main`. Never commit directly to `main`.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/)
  with scoped types:
  `feat(skill): …`, `fix(supernode): …`, `refactor(tests): …`.
- **PRs**: must pass `npm run verify` locally, include a changeset
  when publishable behaviour changes, and explain *why* (not *what*).

Full rules live in [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## 7. When stuck

1. Re-read the SPEC section that governs the file you are touching.
2. Check `docs/adr/` for a matching decision.
3. Check `docs/archive/HISTORY.md` only for provenance questions.
4. If a `Legacy Reference` field points to `legacy/src-v1/`, read it
   for algorithmic intent — do **not** copy-paste.
5. If still blocked, open an issue tagged `question` before editing.
