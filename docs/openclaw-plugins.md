# AgentXP — OpenClaw plugin ledger

> Standing one-page index of OpenClaw plugins authored by the AgentXP
> project. Promote to a sub-directory only when a second plugin
> graduates past planning (see ADR-004 "Revisit triggers").

Each row below is one npm package + one OpenClaw plugin id. The npm
name and the OpenClaw `id` are deliberately different: npm names
scope under `@agentxp/` for provenance; OpenClaw ids are the
host-facing identifier registered in the manifest.

| OpenClaw id | npm name | Repo path | Status | Shipped as | Hooks registered |
|---|---|---|---|---|---|
| `agentxp` | `@agentxp/plugin-v3` | `src/packages/plugin-v3/` | **M7 Batch 1 planned** (ADR-004) | npm public + GitHub | `session_start`, `session_end`, `message_sending`, `before_tool_call`, `after_tool_call`, `agent_end` |

## Planned / reserved

- **`agentxp-skill`** — reserved. An OpenClaw adapter that wraps
  `@agentxp/skill` so prompt-driven Skill users on an OpenClaw host
  get the same install path as Plugin v3 users. No ADR yet; revisit
  after M7 ships.

## Conventions

- **Manifest filename:** `openclaw.plugin.json` at the package root
  (matches legacy v1 convention and OpenClaw SDK default discovery).
- **Entry file:** `dist/adapter.js` exports a default
  `definePluginEntry({ ... })` value. TypeScript source lives at
  `src/adapter.ts`.
- **Peer dependency:** `"openclaw": ">=2026.4.15"`, marked optional
  in `peerDependenciesMeta` so the pure-function library path
  remains usable without the host installed.
- **Publish access:** `publishConfig.access = "public"` for any
  plugin listed here. The `"private": true` flag is removed before
  first publish.
- **Version discipline:** plugins follow semver; breaking changes to
  registered hook signatures bump major. The OpenClaw host version
  compatibility range lives in the plugin's `openclaw.plugin.json`
  under `openclaw.minVersion`, not in `package.json`.

## Out of scope for this ledger

- Third-party plugins that consume the AgentXP relay HTTP API.
  Those belong to a future "AgentXP ecosystem / integrations" index,
  not to this file.
- Non-OpenClaw hosts. Skill-Hermes (Python), the Skill CLI, and any
  future MCP / Claude Code / VS Code adapters are tracked in their
  own package READMEs and in `docs/spec/03-modules-product.md`, not
  here.

## Maintenance

When a plugin listed here changes state (planned → beta → stable →
deprecated) or a new one is added:

1. Edit the table row; keep prior state visible in the Status column
   (e.g. "v0.2.0 stable, v0.3.0 in progress") if useful.
2. Link a commit hash or PR in the row if the status transition is
   non-obvious.
3. If a new plugin arrives, write a fresh ADR (`ADR-NNN`) following
   the shape of ADR-004.
