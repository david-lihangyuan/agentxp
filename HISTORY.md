# HISTORY — Legacy ↔ SPEC mapping

> Recorded: 2026-04-18. SPEC version: **v0.1**.
>
> This file maps every pre-SPEC design document (now living under
> `legacy/`) to the section of the v0.1 SPEC that supersedes or
> references it. Legacy files are preserved byte-for-byte; nothing
> in this mapping rewrites history.
>
> Use this file to answer:
> 1. Where did a given legacy decision end up in the SPEC?
> 2. Which legacy decisions were **not** adopted, and why?
> 3. Which legacy texts remain **normative** alongside the new SPEC?

---

## 1. Still authoritative (not superseded)

| Legacy path | Role in v0.1 |
|---|---|
| `legacy/docs/spec/serendip-protocol-v1.md` | Normative protocol definition. `packages/protocol/` and `03-modules-platform.md §1` incorporate it verbatim; there is no "v0.1 protocol SPEC" separate from this file. |
| `kind-registry/README.md` (not in `legacy/`) | Current conventions for kind registration, referenced by `03-modules-platform.md §6`. |

---

## 2. Adopted into v0.1 SPEC

Files whose contracts, schemas, or design intent were lifted into
`docs/spec/` unchanged or with documented divergence.

| Legacy path | Primary SPEC landing | Divergence (if any) |
|---|---|---|
| `legacy/docs/plans/2026-04-12-phase-a-tdd-spec.md` | `03-modules-platform.md §1 Protocol core` | None. |
| `legacy/docs/plans/2026-04-12-phase-b-tdd-spec.md` | `03-modules-platform.md §2 Relay core routes`; `01-interfaces.md §5.1`, `§5.2` | Human-Layer routes removed from mount list (DP-7). |
| `legacy/docs/plans/2026-04-12-phase-cd-tdd-spec.md` | `02-data-model.md §6 derived views`; `01-interfaces.md §5.2` | Search params reduced to MVP-stable set; extras are deferred per `04-deferred.md §3`. |
| `legacy/docs/plans/2026-04-12-phase-e-tdd-spec.md` | `01-interfaces.md §5.4` (identities + experience reads); `02-data-model.md §3` | None material. |
| `legacy/docs/plans/2026-04-12-phase-fghi-tdd-spec.md` | `03-modules-product.md §3 Skill`, `§7 Dashboard`, `§8 Pulse`, `§9 Feedback loop` | Trace obligation is now asymmetric (DP-4 T5); `weekly-report` endpoint deferred (`04-deferred.md §2.3`); see also `docs/ops/2026-04-18-feedback-loop-rollout.md` for the production `search_log` rollout absorbed into §9. |
| `legacy/docs/plans/2026-04-12-agentxp-v4-design.md` | `00-overview.md §2–§3`; cross-references across all `docs/spec/` | Human Layer surface removed (DP-7); "decentralised relay mesh" narrative replaced by "protocol is decentralisable, MVP ships one relay" (`00-overview.md §5`). |
| `legacy/plugin-v3-design-monolith.md` | `03-modules-product.md §5 Plugin v3` | Workspace-only distribution (DP-4 T3=Y); trace MANDATORY for Plugin v3 emissions. |

---

## 3. Superseded by SPEC decisions

Files whose propositions were **considered and consciously departed
from**. The legacy text is preserved as historical record only.

| Legacy path | Why superseded | SPEC reference |
|---|---|---|
| `legacy/plugin-v2-design-monolith.md` | Plugin v2 class-based surface replaced by v3 hook-driven surface. Not deleted — it documents the pivot. | `04-deferred.md §2.x Plugin v2` (re-entry: none planned) |
| `legacy/docs/plans/plugin-v2/*` (20 files) | Sub-spec split of the v2 monolith; all superseded en bloc by v3. | Same as above. |
| `legacy/docs/plans/2026-04-16-plugin-design.md` | Pivot notes preceding the v3 monolith. Content **partially** absorbed into v3 monolith; remaining parts (e.g. an early class hierarchy proposal) not adopted. | `03-modules-product.md §5 Legacy Reference › Related` |
| `legacy/docs/plans/2026-04-16-plugin-context.md` | Context dump for the pivot; no normative content. Superseded as reference material only. | Not referenced by SPEC. |
| `legacy/docs/plans/2026-04-16-plugin-implementation.md` | Implementation sketches for a pre-v3 shape. | Not referenced by SPEC. |
| `legacy/docs/plans/2026-04-12-ci-fix.md` | Point-in-time CI fix notes; no SPEC relevance. | Not referenced by SPEC. |

---

## 4. Deferred (out of MVP v0.1)

Files whose scope is fully or partially intact but consciously
**not** part of MVP. Each entry carries a pointer to `04-deferred.md`
where re-entry criteria are defined.

| Legacy path | Scope | Deferred to |
|---|---|---|
| `legacy/docs/plans/2026-04-12-phase-human-layer-tdd-spec.md` | Human Layer (letters, trust, agent-voice, contribution) | `04-deferred.md §5 Human Layer` |
| `legacy/docs/plans/2026-04-12-cold-start-pipeline-design.md` | Cold-start corpus seeding pipeline | `04-deferred.md §4 Cold-start pipeline` |

Deferred modules **MUST NOT** be called into by MVP modules
(`03-modules-platform.md § Cross-cutting invariants`). The legacy
text describes the intended re-entry shape; the re-entry process
(ADR + module entry) is specified in `04-deferred.md §6`.

---

## 5. Project meta preserved without SPEC mapping

Files that describe the project itself rather than a technical
surface. No SPEC mapping is required.

| Legacy path | Role |
|---|---|
| `legacy/CLAUDE.md` | Pre-SPEC working conventions for the AI assistant. The active ruleset now lives in the repo root `CLAUDE.md` and, post-Step 5, may migrate to `.augment/rules/`. |
| `legacy/README.md` | Pre-SPEC project README. The current `README.md` at repo root is the authoritative introduction. |

---

## 6. Dedupe note (DP-8, commit `ece2210`)

During BOOTSTRAP §3 Step 2 the `legacy/` root held six UUID-named
files that were, on SHA-256 inspection, three pairs of byte-identical
duplicates:

- `b33cfc1b-…md` + `f6359a96-…md` + `legacy/docs/plans/2026-04-12-agentxp-v4-design.md` — all byte-identical (v4 design triplicate). Kept the semantically-named `plans/` copy; deleted both UUIDs.
- `aa0dcdd1-…md` = `18829805-…md` (Plugin v3 monolith). Kept the alphabetically-earlier UUID, renamed to `legacy/plugin-v3-design-monolith.md`; deleted the other.
- `bd1ec428-…md` = `aa3d3d78-…md` (Plugin v2 monolith). Kept the alphabetically-earlier UUID, renamed to `legacy/plugin-v2-design-monolith.md`; deleted the other.

Net effect: four files removed, two renamed, zero information lost
(every surviving byte sequence is still reachable under a
semantically-named path).

---

## 7. How to keep this file current

- When a deferred feature is promoted into SPEC (`04-deferred.md §6`
  re-entry process), add its legacy pointer to §2 and remove (or
  strike through) its entry in §4.
- When a new legacy document is archived (BOOTSTRAP §0.5 future
  archival rounds), add it to §2, §3, or §4 in the same PR.
- Do **not** delete rows from this file. Superseded decisions are
  historically useful; the whole point of keeping `legacy/` is to
  honour them, not to erase them.
