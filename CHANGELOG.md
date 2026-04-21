# Changelog — Monorepo Milestones

This file tracks **repository-wide milestones** for AgentXP:
scope renames, layout refactors, cross-cutting architectural
changes. Per-package release notes live alongside each package:

- `packages/openclaw-plugin/CHANGELOG.md`
- `packages/skill/CHANGELOG.md`
- `packages/protocol/CHANGELOG.md`
- `packages/supernode/CHANGELOG.md`

Those files are generated automatically by
[Changesets](https://github.com/changesets/changesets) — see
[`docs/RELEASING.md`](docs/RELEASING.md) for the release flow.

---

## 2026-04-21 — Repository refactor (rc phase)

Three commits on branch `refactor/repo-layout` reshape the
monorepo without changing any published package's public API:

- **Scope rename** (`37be2c6`): rewrite every internal import from
  `@serendip/*` to `@agentxp/*`. The `@serendip/*` scope was never
  successfully published, so this is transparent to npm consumers.
- **Layout flatten** (`91e22b3`): move all workspaces from
  `src/packages/*` to `packages/*` at the repository root. See
  [ADR-005](docs/adr/ADR-005-flatten-packages-root.md) (supersedes
  ADR-002).
- **Plugin directory rename** (`1479e51`): rename
  `packages/plugin-v3/` → `packages/openclaw-plugin/`. The npm
  name was already `@agentxp/openclaw-plugin` (ADR-004); the
  default `stagingDbPath` now lives at
  `~/.agentxp/openclaw-plugin/staging.db` with a one-shot
  auto-migrator for rc.1 installs.

Release management now flows through Changesets. Two changesets
covering these commits live in `.changeset/` and will bump:

| Package                    | From       | To          |
| -------------------------- | ---------- | ----------- |
| `@agentxp/openclaw-plugin` | 0.2.0-rc.2 | 0.2.0-rc.3  |
| `@agentxp/skill`           | 0.1.0      | 0.1.1-rc.0  |
| `@agentxp/protocol`        | 0.1.0      | 0.1.1-rc.0  |
| `@agentxp/supernode`       | 0.1.0      | 0.1.1-rc.0  |

---

## [4.0.0] — 2026-04-12 — **Legacy `@agentxp/skill` 4.x line (deprecated)**

> This section documents the pre-SPEC `@agentxp/skill` 4.x npm line.
> All of those published versions (`@agentxp/skill@<=4.8.0`,
> `@agentxp/protocol@1.0.0`) have been deprecated on npm; the
> current packages under `packages/` are the SPEC-driven rewrite
> and are versioned from `0.1.0-rc.*` upwards. This section is
> kept for historical accuracy.

This was the first major open-source release of AgentXP v4 — a complete ground-up rewrite.

### Added

**Core Protocol (`@agentxp/protocol`)**
- Serendip Protocol v1: typed `AgentEvent`, `ExperiencePayload`, `IdentityPayload`
- Ed25519 key pair generation and management (`KeyManager`)
- Merkle proof construction and verification for experience integrity
- Epoch-based key rotation with delegation chains
- Event signature verification pipeline

**Reflection Skill (`@agentxp/skill`)**
- Structured reflection parser (Markdown → `ExperiencePayload`)
- Batch publisher: parse + sign + publish to relay
- Local search index (SQLite-backed, offline-first)
- Proactive recall: surface relevant past experiences at heartbeat time
- Distiller: compress reflection history into long-term memory
- Key renewer: automated rotation before expiry
- Local server: LAN-accessible API for agent interaction
- Heartbeat-chain integration for OpenClaw-based agents
- CLI commands: `status`, `install`, `dashboard`, `config`, `update`

**Supernode (Relay)**
- Pull-based sync with Ed25519 signature verification
- Operator summary, growth timeline, and failure-impact APIs
- Dashboard HTML served at `/dashboard` with strict CSP (no `unsafe-inline`)
- Node registration with challenge-signature proof
- Identity bootstrap (full sync before incremental)
- Weekly report generator with narrative and highlight story

**Contribution Agent System**
- Agent templates: `SOUL.md`, `HEARTBEAT.md`, `CURIOSITY.md`, `BOUNDARY.md`
- Pulse-driven `CURIOSITY.md` updates (demand hotspots, white-space detection)
- First contribution agent: `agents/coding-01`
- A/B experiment tracking with per-agent metrics

**Ecosystem**
- Kind registry (`kind-registry/`) with domain ownership verification
- `io.agentxp.experience` JSON Schema
- SIP issue template for new kind proposals
- CI pipeline: PR checks + automated release with provenance and Docker
- One-command dev bootstrap: `scripts/setup-dev.sh`
- Full TDD test suite: unit, integration, and infra tests

### Changed
- Complete API redesign from v3 (not backward compatible with v3 agents)
- Replaced bespoke encoding with Serendip Protocol canonical format
- Moved from single-file scripts to monorepo (`packages/protocol`, `packages/skill`, `supernode`)

### Security
- All events are Ed25519-signed; relay rejects tampered payloads
- SLSA provenance attestation on npm publishes and Docker images
- CSP on dashboard: `script-src 'self'`, no `unsafe-inline`
- `npm audit --audit-level=high` enforced in CI

---

## [3.x and earlier]

Previous versions were internal/experimental and are not documented here.
Upgrade from v3 requires a full data migration — see `docs/migration-v3-v4.md`.

---

[Unreleased]: https://github.com/serendip-protocol/agentxp/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/serendip-protocol/agentxp/releases/tag/v4.0.0
