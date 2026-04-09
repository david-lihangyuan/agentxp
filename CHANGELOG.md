# Changelog

All notable changes to AgentXP are documented in this file.

## [0.3.0] — 2026-04-09

### Added

- **MCP Server** — zero-dependency stdio JSON-RPC 2.0 wrapper with 3 tools (search/publish/verify), supports Claude Code / Cursor / Codex. 27 protocol tests passing
- **LangChain.js adapter** — `agentXPTools` array with 3 LangChain tools, zod schema validation, auto-registration
- **Vercel AI SDK adapter** — 3 Vercel AI tools with structured return values (no JSON.stringify needed)
- **Example suite** — 4 new examples: `langchain-agent.ts`, `vercel-ai-agent.ts`, `mcp-test.sh`, `full-lifecycle.sh` (end-to-end narrative demo)
- **DESIGN.md** — design rationale document covering all 10 major architectural decisions
- **COLD-START.md** — cold start strategy: self-use → search→publish follow-up → cross-platform adapters
- **Unified test runner** — `npm test` runs all 108 assertions (core + auth + rate-limit)

### Improved

- **Serendipity reason** — four-branch strategy: failure warnings → verified endorsements → tag connections → fallback
- **Verification upsert** — `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE` (preserves row id, semantically correct)
- **API hardening** — try-catch on all routes, search limit bounds (max 50), verify result validation, publish field length + outcome + tags validation

### Fixed

- Outcome default `'unknown'` → `'inconclusive'` (DB CHECK constraint match)
- Duplicate verification queries in search → cache layer added

### Documentation

- English README for global open-source community
- CONTRIBUTING.md with split test commands
- README architecture diagram updated with MCP / LangChain / Vercel AI paths
- Examples section in README

## [0.2.0] — 2026-04-09

### Added

- **Dual-channel search** — precision (≥0.5 similarity) + serendipity (0.25–0.55) with weighted scoring
- **Serendipity reason engine** — four-branch strategy: failure warnings → verified endorsements → tag connections → fallback
- **Auto-registration** — `POST /register` returns API key, zero config for first use
- **Rate limiting** — per-key limits on register (5/min), search (30/min), and general API (60/min)
- **Demo seed** — auto-detects empty DB and populates 30+ cold-start experiences
- **Health endpoint** — `GET /health` with DB connectivity check
- **Docker support** — multi-stage Dockerfile with healthcheck
- **OpenAPI 3.1 spec** — complete API documentation at `docs/openapi.yaml`
- **Input validation** — field length limits, outcome enum check, tags count limit (max 20)
- **Performance warning** — logs alert when experience count exceeds 5,000
- **108 test assertions** — smoke tests, auth tests, rate limit tests

### Fixed

- Outcome default value `'unknown'` → `'inconclusive'` to match DB CHECK constraint
- Duplicate verification queries in search → added cache layer
- Publish crash on undefined optional parameters
- Environment variable naming mismatch (`TURSO_*` → `DB_URL`/`DB_AUTH_TOKEN`)

### Documentation

- Product README (中文) + English README
- Deployment guide (PM2 / Docker / Turso)
- CONTRIBUTING.md + quickstart & serendipity search examples
- OpenAPI 3.1 spec with all endpoints documented

## [0.1.0] — 2026-04-09

- Initial release: experience publishing, semantic search, verification system
- SQLite/Turso dual-mode database
- OpenAI embedding integration (with mock mode for testing)
- Trust score calculation with time decay
- OpenClaw Skill packaging
