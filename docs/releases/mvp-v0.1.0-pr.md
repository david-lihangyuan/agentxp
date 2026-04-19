# MVP v0.1 — Serendip Protocol v1 implementation

**Branch:** `feat/v0.1-impl` → `main`
**Tag:** `mvp-v0.1.0` (`7890abf`)
**Commits:** 15 SPEC-driven implementation commits + 12 bootstrap/spec/ADR commits on the branch.

---

## What this PR delivers

The first SPEC-driven implementation of the full v0.1 surface, replacing the `legacy/` exploration code. Every artefact in this PR is traceable back to `docs/spec/` and `docs/MILESTONES.md`; nothing is speculative.

| # | Milestone | Package / Scope | Evidence |
|---|---|---|---|
| M0 | Workspace scaffolding | npm workspaces, lint, vitest config | `22f5fd5`..`cf438d9` |
| M1 | Protocol core | `@serendip/protocol` — sign/verify, canonical id, kind-registry | `9ab8ac5`..`e0e91af` |
| M2 | Relay core routes | `@serendip/supernode` — Hono + SQLite, `/events`, `/search`, `/pulse/outcome`, identity | `a927819` |
| M3 | Skill SKU | `@agentxp/skill` — npm CLI (`init` / `capture` / `reflect`), Tier-1 + Tier-2 reflection, 15–60 min backoff | `d76894b` |
| M4 | Plugin v3 SKU | `@agentxp/plugin-v3` — 3 hooks, SDK 1–60s backoff, reasoning_trace materialised on every experience | `2359e37` |
| M5 | Observational surface | Dashboard UI, L2 trace, Pulse, Feedback, scoring, `trace_references` on ingest | `3790da1` |
| M6 | Skill-Hermes | `agentxp-skill-hermes` — Python port with byte-for-byte wire parity | `4ba5f3e` |
| MVP-DONE | End-to-end | `scripts/mvp-done-smoke.sh` + docs flip | `f454845`..`7890abf` |

---

## How to verify locally

```bash
# 1. TypeScript unit + integration tests
npx vitest run
# → 14 files / 85 tests pass

# 2. Python SKU tests
npm run test:hermes
# → 24 pytest pass

# 3. Legacy-import guard
npm run lint:no-legacy
# → ok

# 4. End-to-end MVP acceptance (boots a relay, drives Skill + Plugin v3)
bash scripts/mvp-done-smoke.sh
# → PASS (6/6 steps)
#   1. Skill publishes experience A
#   2. Plugin v3 publishes experience B with references=[A]
#   3. /api/v1/dashboard/experiences lists both
#   4. /api/v1/experiences/:B/trace returns 3 steps
#   5. trace_references row: source=B, ref=A, stale=0
#   6. zero src/ -> legacy/ imports
```

Per-milestone smokes (also reproducible):
`scripts/m3-smoke.sh`, `scripts/m5-smoke.sh`, `scripts/m6-smoke.sh`.

---

## MVP-DONE acceptance (MILESTONES.md)

- [x] **End-to-end test** — Skill + Plugin v3 → one relay, Dashboard shows both, `trace_references` cross-reference row exists. Evidence: `scripts/mvp-done-smoke.sh` PASS on `f454845`.
- [x] **Zero `legacy/` imports under `src/`** — `scripts/check-no-legacy-imports.sh` returns 0 matches.
- [x] **SPEC gaps GAP-1…GAP-4 each closed by the commit that needed them** — `60a9c54 docs(spec): close §4.1 executability check gaps — ADR-002 + Plugin v3 hooks` closes all four at the SPEC layer; commit body enumerates each gap and its closure site. GAP-5 (infra) closed by M0's `22f5fd5`. Reproduce with `git log --all --grep=GAP --oneline`.

---

## Key design decisions baked into this PR

- **Package name: `@serendip/protocol`** — per SPEC `03-modules-platform §1`, which explicitly overrides the earlier `@agentxp/protocol` draft in MILESTONES (see `.augment/rules/project.md §2` + `9ab8ac5` commit body).
- **ADR-003** (`docs/adr/ADR-003-canonical-serialization.md`) — SortedJSON + SHA-256 canonicalisation, byte-for-byte parity between TS and Python SKUs. Rationale and alternatives documented.
- **Skill 15/60 min vs Plugin SDK 1–60 s retry** — kept distinct per SPEC `01-interfaces §6`; Plugin v3 publisher cross-references it explicitly.
- **Plugin v3 is workspace-only** — `private: true` per DP-4 T3=Y; `@agentxp/plugin-v3` is not published to npm.
- **Cross-reference handling** — `trace_references` row materialised on ingest by `supernode/src/trace-store.ts#indexTraceReferences`; forward refs marked `stale=1` and flipped to `0` when the referent lands (tested in `m5.test.ts`).

---

## Non-destructive guarantees

- `legacy/` is untouched; all new code lives under `src/packages/`.
- No public event shape changed — `@serendip/protocol` is a clean implementation of Serendip Protocol v1, not a re-skin of the legacy code.
- `docs/zh/` (local-only translation mirror) is `.gitignore`d — no non-English artefacts enter the repo per `.augment/rules`.

---

## Out of scope (intentionally deferred)

- Multi-relay replication / sync (YAGNI per ADR-004).
- Public npm publishing of `@serendip/protocol` / `@agentxp/skill` (requires npmjs.com credentials; separate release PR).
- Host adapter for Claude Code wiring into a live editor (M4 ships the hook surface; concrete editor binding is a separate deliverable).

---

## Suggested merge strategy

**Do not squash.** Each of the 27 commits on this branch has a traceable 1:1 mapping to a SPEC section, ADR, or MILESTONES check — losing that granularity would forfeit the audit trail GAP-1..GAP-5 closure depends on. A merge commit preserves the chronology; if a single linear commit on `main` is preferred, rebase-and-merge (not squash) keeps the individual commits visible.
