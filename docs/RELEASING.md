# Releasing

AgentXP uses [Changesets](https://github.com/changesets/changesets) for
version management and npm publishing. In practice the flow is:

1. You make a code change on a feature branch.
2. You (or the AI assistant) write a `.changeset/*.md` describing what
   changed and at what semver level.
3. You open a PR. CI enforces that a changeset exists (or is explicitly
   marked as not requiring a release).
4. When the PR merges to `main`, a bot-managed "Version Packages" PR
   appears on `main` itself, collecting all pending changesets.
5. Merging that PR bumps `package.json` versions, rewrites
   `CHANGELOG.md` in each affected package, and publishes anything
   public to npm.

You rarely touch any of this directly — ask the AI assistant to "write a
changeset for this change" or "release the plugin" and it will execute
the flow below on your behalf.

---

## Writing a changeset

From the repo root:

```bash
npx changeset
```

This walks you through three questions:

- **Which packages changed?** Pick with space; submit with enter.
- **Is it major / minor / patch for each?**
  - `patch` — bug fix, refactor, docs, internal cleanup.
  - `minor` — new feature, new public API, user-visible behaviour
    change that is backwards-compatible.
  - `major` — breaking change to a public API.
- **Summary?** One paragraph. Will appear verbatim in the package's
  `CHANGELOG.md`.

The tool writes a random-named markdown file under `.changeset/`.
**Commit that file** with your code change.

If a change truly needs no release (pure docs, CI, internal scripts):

```bash
npx changeset --empty
```

Alternatively label the PR `no-release` to bypass the CI gate.

---

## Pre-release mode (rc channel)

The repository is currently in **pre-release mode with tag `rc`**.
Every `changeset version` produces pre-release versions like
`0.2.0-rc.3` or `0.1.1-rc.0`, and `changeset publish` publishes them
with the `rc` dist-tag (not `latest`).

To exit pre-release and cut a stable version:

```bash
npx changeset pre exit
npx changeset version    # now produces stable versions
```

Do **not** `pre exit` casually — it's a one-way commitment for the
current batch of changesets.

---

## Private packages

Three of the four published-eligible packages are currently
`"private": true`:

- `@agentxp/skill`
- `@agentxp/protocol`
- `@agentxp/supernode`

Changesets will still version-bump them (and regenerate their
CHANGELOG) — they just won't be pushed to npm. When one is ready for
public release, remove `"private": true` from its `package.json` in a
dedicated PR with a changeset describing the graduation.

The only package currently published to npm is
`@agentxp/openclaw-plugin`.

---

## The release flow

### What the AI assistant does on `release`

When you say "release", the assistant runs:

1. `npx changeset status` — show what will happen.
2. Propose a version plan (accept / adjust / dry-run / cancel).
3. On accept: `npx changeset version` — bumps versions, rewrites
   per-package `CHANGELOG.md`, deletes consumed `.changeset/*.md`.
4. `npm run typecheck && npm test` — verification.
5. Commit + push.
6. On `main`, the `.github/workflows/release.yml` workflow picks
   up the bump commit and invokes `changesets/action@v1`, which
   either opens a "Version Packages" PR or (when already on the
   bump commit) runs `changeset publish` to push to npm.

### Secrets required in the GitHub repo

- `NPM_TOKEN` — automation token with `publish` on `@agentxp/*`.
- `GITHUB_TOKEN` — provided automatically by Actions; used by
  `changesets/action` to open the Version Packages PR.

---

## Historical note

The `@agentxp/skill` 1.x–4.x line and `@agentxp/protocol@1.0.0` on
npm are **deprecated** — they predate the current SPEC-driven
rewrite. The current `packages/` tree starts fresh from `0.1.x`
(internal) and `0.2.0-rc.*` (plugin). See `CHANGELOG.md` and
`HISTORY.md` for the cut-over narrative.
