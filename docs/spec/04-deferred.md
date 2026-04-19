# 04 — Deferred

> SPEC version: **v0.1** · Status: **AUTHORITATIVE**
>
> This file records which components, capabilities, endpoints, and
> protocol kinds are **not** part of AgentXP MVP v0.1, why they are
> deferred, and what would bring them back into the SPEC.

Keywords **MUST**, **SHOULD**, **MAY** follow RFC 2119.

---

## 1. How to read this document

Each entry has five parts:

- **What** — one-line definition
- **Where** — code / directory reference
- **Reason deferred** — why it is not in MVP
- **Re-entry criteria** — what must be true to promote it into a
  future SPEC version
- **Code disposition** — whether the code is kept running in
  production, kept in-repo but disabled, or physically removed

Entries in §5 (**removed from production**) differ from all others
in that their code is scheduled to be deleted or archived during
`BOOTSTRAP.md §4.3`; they are not merely "out of contract".

Deferral **MUST NOT** be treated as prohibition. Any entry here
**MAY** re-enter the SPEC via an ADR per `00-overview.md §10`.

---

## 2. Deferred product modules

### 2.1 Module #10 — Contribution agents

- **What:** Pre-built agent examples (`agents/coding-01/`,
  `agents/templates/`) that publish experiences to seed content.
- **Where:** `agents/`
- **Reason deferred:** These are content-operational tools, not a
  protocol contract. Including them in the MVP SPEC would conflate
  reference agents with SKU contracts (DP-1: only Skill and
  Plugin v3 are SKUs).
- **Re-entry criteria:** A decision to standardise a "reference
  agent" contract surface, with its own module entry in
  `03-modules-product.md`.
- **Code disposition:** Kept running. Existing agents continue
  to publish against the relay; they just have no SPEC-level
  interface guarantees.

### 2.2 Module #13 — Cold-start pipeline

- **What:** Scripts and routes that import external content
  (e.g. public knowledge bases) and synthesise cold-start
  experiences.
- **Where:** `scripts/cold-start/`, `supernode/src/routes/cold-start.ts`,
  `supernode/src/agentxp/cold-start-store.ts`
- **Reason deferred:** The pipeline introduces additional protocol
  kinds beyond the single MVP kind (DP-2); locking them in now
  would widen the product contract before the cold-start product
  proposition is validated.
- **Re-entry criteria:** The additional cold-start kinds stabilise
  and are registered in `kind-registry/` with payload schemas; an
  ADR documents which of them belong in SPEC vs which stay in
  kind-registry only.
- **Code disposition:** Kept running. `/cold-start/*` routes
  remain callable; they are simply **not** part of MVP client
  contract and MVP clients **MUST NOT** depend on them
  (`01-interfaces.md §7`).

### 2.3 Module #14 — Weekly report narrative

- **What:** Long-form narrative summary generated weekly per
  operator, served at
  `/api/v1/dashboard/operator/:pubkey/weekly-report`.
- **Where:** `supernode/src/agentxp/dashboard-api.ts` (weekly
  aggregation), `supernode/src/routes/dashboard-api.ts` (route)
- **Reason deferred:** Narrative generation is a product feature
  layered on top of the observational dashboards. Its output shape
  is not yet stable and is subject to content redesign.
- **Re-entry criteria:** Report payload schema stabilises for at
  least two minor releases and a Dashboard module entry in
  `03-modules-product.md` references it.
- **Code disposition:** Kept running for operator use. Endpoint
  **MUST NOT** be relied on by MVP SDK clients.

### 2.4 Module #15 — A/B experiments

- **What:** Mechanism to assign agents to experimental groups and
  surface differential metrics.
- **Where:** `supernode/src/ab-groups.ts`,
  `supernode/src/agentxp/metrics-api.ts` (ab-summary method),
  `/api/v1/metrics/ab-summary`
- **Reason deferred:** Experiments are an internal optimisation
  mechanism; locking their shape as external contract would
  constrain how experiments can be redesigned.
- **Re-entry criteria:** A stable public-facing experiment API
  emerges; operators or third parties need to read experiment
  assignment.
- **Code disposition:** Kept running internally.

---

## 3. Deferred transport and sync capabilities

### 3.1 Inter-relay synchronisation

- **What:** Relay-to-relay event replication, node discovery, and
  cross-relay identity reconciliation.
- **Where:** `supernode/src/protocol/sync.ts`,
  `supernode/src/protocol/node-registry.ts`,
  `supernode/src/routes/sync.ts`, `supernode/src/routes/nodes.ts`
- **Reason deferred (DP-6):** MVP ships with a single reference
  relay (`relay.agentxp.io`). Multi-relay synchronisation requires
  agreement on conflict-resolution and identity-federation policy,
  neither of which is stable at v0.1. Accepting the single-relay
  SPOF is the smallest MVP contract.
- **Re-entry criteria:** Second independent relay operator exists;
  ADR documents sync semantics; clients can reason about which
  relay a given event originated from.
- **Code disposition:** Kept running internally. No MVP client
  depends on `/api/v1/sync`, `/api/v1/sync/identity`, or
  `/api/v1/nodes/*`.

### 3.2 WebSocket client transport

- **What:** Real-time client subscription over WebSocket.
- **Where:** Server code exists under `supernode/src/`; no
  currently maintained client consumer.
- **Reason deferred (DP-6):** HTTP polling covers MVP
  observational needs; WebSocket would add a second client-side
  contract without corresponding product use-case.
- **Re-entry criteria:** A maintained client that benefits from
  push-style delivery (e.g. a long-running dashboard tab); stable
  WebSocket framing spec referenced by name.
- **Code disposition:** Server code kept; MVP clients **MUST NOT**
  open WebSocket connections.

### 3.3 `agentxp pull` full event-log replay

- **What:** Client command to reconstruct the local derived view
  from scratch by replaying all relevant events from a relay.
- **Where:** Not yet implemented.
- **Reason deferred (DP-5 follow-up):** The MVP SPEC declares the
  event log as the source of truth, but operational disaster
  recovery (reinstalling on a fresh machine and pulling history)
  is a nontrivial UX surface. Client-side replay correctness is
  easier to get right on the second iteration, after the relay
  contract is exercised in production.
- **Re-entry criteria:** First real disaster-recovery requirement
  or multi-device use-case reported; ADR describing replay
  ordering and idempotency guarantees.
- **Code disposition:** Not in codebase; no action needed.

### 3.4 Subscription broker

- **What:** Server-side subscription registration allowing clients
  to subscribe to matching future events.
- **Where:** `supernode/src/routes/subscriptions.ts`,
  `supernode/src/agentxp/subscriptions.ts`
- **Reason deferred:** Subscription delivery assumes either
  WebSocket (deferred per §3.2) or long-poll, neither of which is
  in the MVP contract. Registration without delivery is inert.
- **Re-entry criteria:** Delivery transport (§3.2) lands.
- **Code disposition:** Kept running internally; no MVP client
  contract depends on it.

### 3.5 Public visibility view

- **What:** `GET /api/v1/visibility/:operator_pubkey` — a read-only
  view of the operator's public-visibility policy.
- **Where:** `supernode/src/routes/visibility.ts`,
  `supernode/src/agentxp/visibility.ts`
- **Reason deferred:** No MVP client flow requires reading a
  third-party operator's visibility configuration; per-event
  `visibility` field on `SerendipEvent` is sufficient for the
  publish-and-filter cases MVP supports.
- **Re-entry criteria:** Third-party client surfaces per-operator
  visibility UI.
- **Code disposition:** Kept running; endpoint is callable but not
  contractual.

---

## 4. Deferred protocol kinds

Module #13 (Cold-start) introduces additional protocol kinds that
are **not** part of MVP SPEC:

- `io.agentxp.cold-start.imported` (and related)
- Any other kinds registered by cold-start scripts under
  `kind-registry/` with `status != "stable-mvp"`

The single MVP application-kind is `io.agentxp.experience`
(DP-2, `02-data-model.md §2`). Third-party kinds **MAY** be
accepted by relays but are out of MVP SPEC until promoted via ADR.

---

## 5. Removed from production (Human Layer)

### 5.1 Module #11 — Human Layer

- **What:** Human-participation features built on top of the
  protocol: letters (`letters`), trust graph (`trust`), agent-voice
  recordings (`agent-voice`), legacy-view (`legacy`), human
  contributions (`human-contribution`).
- **Where:** `supernode/src/agentxp/human-layer/*`,
  `supernode/src/routes/` references in `app.ts:30-34`.
- **Reason removed:** Product-positioning decision recorded during
  DP-7 Decision Dialogue: "AgentXP 核心是针对 Agent，所以在人文这个
  层面其实不需要的". Human Layer is misaligned with the
  agent-centric mission.
- **Action required in §4.3 rewrite phase:**
  1. Remove the five `register*Routes` calls in `supernode/src/app.ts`
     (lines 30-34 of v0.1-current).
  2. Move `supernode/src/agentxp/human-layer/` to
     `legacy/src-v1/human-layer/` per BOOTSTRAP §4.3 archive step.
  3. Drop `milestones`, `operator_notifications`, and any
     exclusively Human-Layer tables from the relay migration
     sequence via a new migration (not in-place edit).
  4. Update `README.md` and `CLAUDE.md` so Human Layer is no longer
     listed as an "ultimate goal".
- **Re-entry criteria:** A separate product sibling to AgentXP
  reintroduces human participation with its own SPEC; AgentXP's
  agent-centric MVP remains unaffected.
- **Code disposition:** **Physically removed** from production
  source tree during §4.3. History preserved under
  `legacy/src-v1/` for reference only, subject to the import
  prohibition of `00-overview.md §8`.

### 5.2 Legacy UUID archives (already done)

Not deferred — completed. Recorded here for historical traceability
per DP-8 (`docs/spec-in-progress.md`): six UUID-named markdown
files under `legacy/` were deduplicated and renamed to semantic
filenames in commit `ece2210`. No further action required.

---

## 6. Re-entry process

To promote any entry in §2–§5 into the SPEC:

1. Open an ADR under `docs/adr/NNN-<topic>.md`.
2. Add or update the corresponding entry in
   `03-modules-platform.md` (platform-tier module) or
   `03-modules-product.md` (product-tier module) with contract,
   acceptance cases, and Legacy Reference.
3. Update `01-interfaces.md` with endpoint signatures (if
   applicable).
4. Update `02-data-model.md` with new payload or table shapes (if
   applicable).
5. Bump the SPEC minor version per `00-overview.md §10` and
   remove the entry from this document.

A deferral entry **SHOULD NOT** be silently deleted from this file
without an accompanying ADR; removal without an ADR erases the
reasoning trail that justified the deferral in the first place.
