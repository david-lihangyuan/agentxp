---
'@agentxp/openclaw-plugin': minor
---

Rename the on-disk directory from `packages/plugin-v3/` to
`packages/openclaw-plugin/` (the npm name was already
`@agentxp/openclaw-plugin`) and move the default staging location
to match.

User-visible behaviour changes:

- The default `stagingDbPath` moves from
  `~/.agentxp/plugin-v3/staging.db` to
  `~/.agentxp/openclaw-plugin/staging.db`.
- On first run, a one-shot migrator in `openDbFromConfig`
  automatically renames `~/.agentxp/plugin-v3/` to
  `~/.agentxp/openclaw-plugin/` if the old directory exists and the
  new one does not, so rc.1 users keep their staged experiences.
- Custom `stagingDbPath` values are **not** touched — the migrator
  only fires when the caller is using the canonical default path.
- Migration failures are non-fatal: the plugin logs one warning and
  falls back to a fresh directory.

Also fixes a stale `@agentxp/plugin-v3` import in
`scripts/mvp-done-plugin-publish.mjs` that was left over from the
M7 Batch 1 npm-name rename (ADR-004).
