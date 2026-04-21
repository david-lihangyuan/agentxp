# Archive

Historical process documents from the BOOTSTRAP phase of AgentXP. All
files in this directory are **read-only historical artefacts**. They
are retained for provenance and reproducibility, not as living
documentation.

The SPEC under `docs/spec/` and the ADRs under `docs/adr/` are the
authoritative sources going forward. When these archived documents
and the SPEC disagree, the SPEC wins.

## Contents

| File | Origin | Superseded by |
|---|---|---|
| `BOOTSTRAP.md` | One-shot initialisation workflow (§1–§5). Graduated at commit `f4bd032`. | `docs/spec/` + `.augment/rules/project.md` |
| `spec-survey.md` | BOOTSTRAP §3 Step 1 — repository snapshot, 2026-04-18. | `docs/spec/00-overview.md` |
| `spec-in-progress.md` | BOOTSTRAP §3 Step 2 — DP-1…DP-8 decision dialogue ledger. All points DECIDED. | ADRs + `docs/spec/` |
| `spec-knowledge-gaps.md` | BOOTSTRAP §3 knowledge-gap ledger. Single entry (DP-3) resolved by ADR-001. | `docs/adr/ADR-001-reflection-trigger.md` |
| `legacy-sweep-plan.md` | BOOTSTRAP §3 Step 0.5 — archival plan, executed 2026-04-18. | `HISTORY.md` (this directory) |
| `MILESTONES.md` | MVP M0–M7 milestone tracker. M0–M6 + MVP-DONE tagged `mvp-v0.1.0`; M7 shipped as `0.2.0-rc.1` on 2026-04-20. | GitHub releases + issue tracker |
| `HISTORY.md` | BOOTSTRAP §3 one-shot Legacy ↔ v0.1 SPEC mapping (2026-04-18 snapshot). | `CHANGELOG.md` (ongoing repo milestones); one normative fact — `legacy/docs/spec/serendip-protocol-v1.md` — is preserved in `.augment/rules/project.md §1`. |

## Known staleness

Path references inside these documents predate the ADR-005 flatten
(`src/packages/*` → `packages/*`) and the `plugin-v3 → openclaw-plugin`
rename. In particular, expect to see:

- `supernode/src/...` where the code now lives at `packages/supernode/src/...`
- `packages/plugin-v3/` where the directory is now `packages/openclaw-plugin/`
- `@agentxp/plugin-v3` as the npm name where the published name is now
  `@agentxp/openclaw-plugin`

These references are **intentionally not rewritten**: the archive
preserves what was true at the time the document was written. Follow
ADR-005 and ADR-004 to translate to the current layout.
