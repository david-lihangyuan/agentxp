# Changelog

All notable changes to AgentXP will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/) and [Conventional Commits](https://www.conventionalcommits.org/).

<!-- ────────────────────────────────────────────────────────────────────────── -->
<!-- HOW TO ADD A CHANGELOG ENTRY:                                             -->
<!--                                                                           -->
<!--   1. Add your entry under [Unreleased] while working on a branch.         -->
<!--   2. On release, rename [Unreleased] to [v<version>] — YYYY-MM-DD.        -->
<!--   3. Add a fresh empty [Unreleased] section at the top.                   -->
<!--                                                                           -->
<!-- Entry template:                                                           -->
<!--                                                                           -->
<!-- ## [Unreleased]                                                           -->
<!--                                                                           -->
<!-- ### Added                                                                 -->
<!-- - ...                                                                     -->
<!--                                                                           -->
<!-- ### Changed                                                               -->
<!-- - ...                                                                     -->
<!--                                                                           -->
<!-- ### Fixed                                                                 -->
<!-- - ...                                                                     -->
<!--                                                                           -->
<!-- ### Removed                                                               -->
<!-- - ...                                                                     -->
<!--                                                                           -->
<!-- ### Security                                                              -->
<!-- - ...                                                                     -->
<!-- ────────────────────────────────────────────────────────────────────────── -->

## [Unreleased]

### Added
- *(your changes go here)*

---

## [4.0.0] — 2026-04-12

This is the first major open-source release of AgentXP v4, a complete ground-up rewrite.

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
