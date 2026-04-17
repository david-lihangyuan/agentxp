# Contributing to AgentXP

Thank you for your interest in contributing! This document covers everything you need to know to contribute effectively.

---

## Table of Contents

1. [Branch Strategy](#branch-strategy)
2. [PR Requirements](#pr-requirements)
3. [Hotfix Process](#hotfix-process)
4. [Kind Registration](#kind-registration)
5. [Code Style](#code-style)
6. [Testing](#testing)
7. [Commit Messages](#commit-messages)
8. [License](#license)

---

## Branch Strategy

We use a simplified **GitHub Flow** model:

| Branch | Purpose | Merges into |
|--------|---------|-------------|
| `main` | Stable branch. Always releasable, always green. Tagged with semver. | — |
| `feature/<name>` | New features. Branch from `main`. | `main` (via PR) |
| `fix/<name>` | Bug fixes. Branch from `main`. | `main` (via PR) |
| `refactor/<name>` | Refactors. Branch from `main`. | `main` (via PR) |
| `chore/<name>` | Build, deps, docs, or tooling chores. Branch from `main`. | `main` (via PR) |

### Rules

- **Never commit directly to `main`.** All changes must go through a PR.
- `main` must stay green: tests pass, type-checks pass.
- Feature branches should be short-lived (< 2 weeks). Prefer small, frequent PRs.
- Branch names use `kebab-case`: `feature/kind-registry-validation`, `fix/relay-timeout`.
- Prefer **squash merge** to keep `main` history linear and readable.

---

## PR Requirements

All pull requests must satisfy the following before merge:

### Checklist

- [ ] **Tests pass**: `npx vitest run` exits 0.
- [ ] **Type-check passes**: `tsc --noEmit` for all affected packages.
- [ ] **No lockfile drift**: `npm ci --frozen-lockfile` must succeed.
- [ ] **Integration tests pass** if the change touches the relay, publisher, or install flow.
- [ ] **Security audit clean**: `npm audit --audit-level=high` has no high/critical findings.
- [ ] **CHANGELOG.md updated** in the `[Unreleased]` section.
- [ ] PR description explains *why* the change is needed, not just *what* was changed.
- [ ] For new public APIs: JSDoc added.

### Review

- At least **1 approving review** required before merge.
- Reviewers must check: correctness, test coverage, and backward compatibility.
- For solo-maintainer projects, self-review plus green CI is acceptable; larger / breaking changes should still wait for a second pair of eyes when possible.

### PR Size Guidelines

- Aim for < 400 lines changed per PR.
- Larger changes should be broken into a series of smaller PRs with a tracking issue.

---

## Hotfix Process

For critical production bugs that cannot wait for a batched release:

1. **Branch from `main`**:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b fix/describe-the-fix
   ```

2. **Apply the fix** with a minimal, focused change. Include a regression test.

3. **Update CHANGELOG.md**: add an entry under the current version (not `[Unreleased]`).

4. **Open a PR targeting `main`** with the `hotfix` label; merge once CI is green.

5. After merge to `main`, **tag the release**:
   ```bash
   git tag -a v4.0.1 -m "Hotfix: describe the fix"
   git push origin v4.0.1
   ```

> ⚠️ **Critical**: hotfix branches must only contain the minimum change needed. Do not bundle unrelated fixes.

---

## Kind Registration

<!-- kind registration -->
AgentXP supports extensible experience kinds following a reverse-DNS naming convention (e.g., `io.agentxp.experience`, `com.example.myapp.session`).

### Registering a New Kind

1. **Domain ownership verification is required** before a kind prefix can be registered. This prevents namespace squatting and ensures accountability.

   - For `io.agentxp.*` kinds: submit a [SIP (Serendip Improvement Proposal)](.github/ISSUE_TEMPLATE/sip.md) via GitHub Issues.
   - For your own domain (e.g., `com.yourcompany.*`): prove domain ownership by adding a DNS TXT record:
     ```
     _agentxp-kind-verify.<yourdomain>  TXT  "agentxp-kind=<your-github-handle>"
     ```

2. **Create the JSON Schema** in `kind-registry/kinds/<reverse-dns-id>.json`.

3. **Follow the schema template** in `kind-registry/README.md`.

4. **§10 is immutable**: The core fields defined in §10 of the AgentXP spec (`id`, `kind`, `agent_key`, `operator_key`, `signature`, `timestamp`) must not be modified or omitted. Custom kinds may extend the payload but must not conflict with §10 fields.

5. **Open a PR** targeting `main` with the `kind-registration` label.

> See `kind-registry/README.md` for the full naming convention and schema requirements.

---

## Code Style

We use **TypeScript** throughout. Follow these conventions:

### General

- **No `any`** — use `unknown` + type guards instead.
- **No `as` casts** unless unavoidable; add a comment explaining why.
- Prefer `const` over `let`; avoid `var`.
- Use `===` strict equality always.

### Naming

- `PascalCase` for types, interfaces, classes.
- `camelCase` for variables, functions, methods.
- `SCREAMING_SNAKE_CASE` for module-level constants.
- Files: `kebab-case.ts`.

### Formatting

We use **Prettier** defaults. Run before committing:
```bash
npx prettier --write .
```

### Imports

- External packages first, then internal (`@agentxp/*`, `@serendip/*`), then relative.
- No barrel re-exports unless the package is explicitly a public API surface.

### Error handling

- Never silently swallow errors.
- User-facing CLIs must print a helpful message (not a stack trace) for expected error conditions (missing config, missing workspace, etc.).
- For unexpected errors, include the original error in the message and exit with code 1.

---

## Testing

- All new features must include unit tests using **Vitest**.
- Use `describe` / `it` naming that reads as plain English.
- Test files go in the `tests/` subfolder next to the source they test (or in `tests/infra/` for cross-package infrastructure tests).
- Aim for **> 80% coverage** on new code.
- Integration tests go in `tests/integration/`.

---

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer: BREAKING CHANGE, Closes #N]
```

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change without fix or feature |
| `test` | Adding or fixing tests |
| `chore` | Build tooling, dependencies |
| `perf` | Performance improvement |

Examples:
- `feat(relay): add pull-based sync with signature verification`
- `fix(cli): show helpful error when workspace is missing`
- `docs: I5 CONTRIBUTING`

---

## License

By contributing to AgentXP, you agree that your contributions will be licensed under the [MIT License](LICENSE).
