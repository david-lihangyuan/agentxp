---
'@agentxp/openclaw-plugin': patch
'@agentxp/skill': patch
'@agentxp/protocol': patch
'@agentxp/supernode': patch
---

Repository layout refactor (transparent to npm consumers):

- Rename the npm scope from `@serendip/*` to `@agentxp/*` across every
  package. The `@serendip/*` scope was never successfully published,
  so this change only touches internal imports, build config, and
  documentation.
- Flatten the monorepo layout from `src/packages/*` to `packages/*`
  at the repository root. See `docs/adr/ADR-005-flatten-packages-root.md`
  (which supersedes ADR-002).

Both changes are source-tree-only; the published package contents
(`dist/`, `package.json` metadata, public API) are unchanged.
