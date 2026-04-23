# @agentxp/supernode

## 0.1.1

### Patch Changes

- 9fd437b: Repository layout refactor (transparent to npm consumers):

  - Rename the npm scope from `@serendip/*` to `@agentxp/*` across every
    package. The `@serendip/*` scope was never successfully published,
    so this change only touches internal imports, build config, and
    documentation.
  - Flatten the monorepo layout from `src/packages/*` to `packages/*`
    at the repository root. See `docs/adr/ADR-005-flatten-packages-root.md`
    (which supersedes ADR-002).

  Both changes are source-tree-only; the published package contents
  (`dist/`, `package.json` metadata, public API) are unchanged.

- 9fd437b: Supernode hardening, test modularization, and dependency hygiene:

  - Escape SQL `LIKE` metacharacters in `/api/v1/search` so operator
    queries containing `%` or `_` no longer produce accidental
    wildcard matches.
  - Split the monolithic `src/app.ts` into topic-scoped routers under
    `src/routes/` (`events`, `experiences`, `pulse`, `metrics`,
    `dashboard`, `search`, `identity`, `relay`) without changing any
    HTTP surface. All 22 endpoints remain byte-compatible, verified
    by a 238-test characterization suite.
  - Consolidate in-memory test fixtures into `src/testing.ts` and
    expose them via a new `@agentxp/supernode/testing` subpath export
    so `skill` and `openclaw-plugin` no longer reach across package
    boundaries with relative paths.
  - Shared `fetchJson` test helper is now generic (`fetchJson<T>`),
    catching unsafe property accesses at compile time.
  - Bump `hono` to `4.12.14` and `@types/better-sqlite3` to `7.6.13`
    (patch-level bumps, no behaviour change).
  - Pin `engines.node` to `>=22` on every workspace to match the
    version installed by `actions/setup-node` in CI.

- Updated dependencies [9fd437b]
  - @agentxp/protocol@1.0.1
