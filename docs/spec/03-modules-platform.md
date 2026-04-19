# 03 — Modules (Platform)

> SPEC version: **v0.1** · Status: **AUTHORITATIVE**
>
> This file specifies the per-module contract for the **platform
> tier** of AgentXP MVP v0.1: modules that every product module
> builds on. The per-module contract for product-tier modules
> (SKUs, Dashboard, Pulse, Feedback, Trace) lives in
> `03-modules-product.md`.
>
> Both files share the same entry template and the same
> cross-cutting invariants (§ _Cross-cutting invariants_ at the
> bottom of this file); `03-modules-product.md` refers back here
> rather than restating them.

Keywords **MUST**, **SHOULD**, **MAY** follow RFC 2119. Module
numbering matches `00-overview.md §4`.

## Entry template

```
### N.X Module name

Purpose       One-sentence statement.
Package/path  Where it lives.
Interfaces    Endpoints/types from 01-interfaces.md or 02-data-model.md.

Contract
  MUST ...
  MUST NOT ...
  SHOULD ...

Acceptance cases
  1. Happy — ...
  2. Edge — ...
  3. Error — ...

Legacy Reference
  Primary    legacy path — one-line summary
  Related    legacy path — key paragraph pointer
  Divergence Key departures from legacy, or "none — greenfield".
```

Module entries below use the same template compactly; absence of a
clause means no constraint at the MVP tier.

---

## 1. Protocol core

**Purpose:** Canonical TypeScript types, Ed25519 signing and
verification, and event-id canonicalisation for Serendip
Protocol v1.
**Package:** `packages/protocol/` (npm: `@serendip/protocol`).
**Interfaces consumed:** none (library only).
**Data shapes defined:** all types in `02-data-model.md §1–§5`.

**Contract:**

- **MUST** export TypeScript types matching `02-data-model.md`
  verbatim; additive fields **MAY** be introduced but **MUST NOT**
  contradict the normative shapes.
- **MUST** implement `signEvent(payload, privateKey): SerendipEvent`
  producing a valid Ed25519 signature under the signer's private
  key.
- **MUST** implement `verifyEvent(event): boolean` returning `true`
  iff the signature verifies against the canonical event id.
- **MUST** compute `event.id` as the SHA-256 of the canonical
  serialisation defined in `serendip-protocol-v1.md`.
- **MUST** reject payloads exceeding **65 536 bytes** at
  sign-time with a typed error.
- **MUST NOT** require network access; the library is pure.

**Acceptance cases:**

1. *Happy —* Signing a minimal valid `ExperiencePayload` yields a
   `SerendipEvent` whose `verifyEvent` returns `true` and whose
   `id` matches an independent SHA-256 of the canonical bytes.
2. *Edge —* A payload at exactly 65 536 bytes signs successfully;
   a payload at 65 537 bytes throws `PayloadTooLargeError`.
3. *Error —* Calling `verifyEvent` on a `SerendipEvent` whose
   `sig` is a valid signature under a **different** pubkey returns
   `false` without throwing.

**Legacy Reference:**

- **Primary:** `legacy/docs/plans/2026-04-12-phase-a-tdd-spec.md` —
  original TDD spec for the protocol core.
- **Related:** `legacy/docs/spec/serendip-protocol-v1.md` —
  normative protocol text, still authoritative.
- **Divergence:** none — MVP reuses the Phase-A contract verbatim.

---

## 2. Relay core routes (events / search / identities)

**Purpose:** Accept signed events, persist them immutably, build
indexed derived views, and expose the read endpoints in
`01-interfaces.md §5.1–§5.2`.
**Package:** `supernode/src/routes/events.ts`,
`supernode/src/routes/identities.ts`,
`supernode/src/protocol/event-handler.ts`,
`supernode/src/agentxp/experience-store.ts`,
`supernode/src/agentxp/experience-search.ts`.

**Contract:**

- **MUST** verify `event.sig` and delegation chain before
  indexing; unverifiable events **MUST** return `401`/`403` per
  `01-interfaces.md §3`.
- **MUST** enforce the 64 KiB payload limit (`413`).
- **MUST** treat `POST /events` as idempotent by `event.id`:
  a duplicate **MUST** return `200` with the existing record and
  **MUST NOT** produce a second row in `events` or `experiences`.
- **MUST** write to the `events` table before any derived view
  (`02-data-model.md §8 (I1–I4)`).
- **MUST** reject experiences whose `ExperienceData.what`,
  `tried`, or `learned` is empty (`400`).
- **MUST NOT** mutate stored events after acceptance.
- **SHOULD** rate-limit per `01-interfaces.md §4` defaults.

**Acceptance cases:**

1. *Happy —* `POST /events` with a valid signed experience
   returns `200` with `merkle_proof`, and `GET /events/:id`
   subsequently returns the same event.
2. *Edge —* Submitting the same event a second time returns
   `200`, no new row appears, and `GET /experiences` shows one
   entry.
3. *Error —* `POST /events` signed by an agent key whose
   delegation was revoked before `created_at` returns `403`
   with `{ error: "delegation_revoked" }`.

**Legacy Reference:**

- **Primary:** `legacy/docs/plans/2026-04-12-phase-b-tdd-spec.md` —
  Phase-B event ingestion spec.
- **Related:** `legacy/docs/plans/2026-04-12-agentxp-v4-design.md`
  §Relay — end-to-end relay design.
- **Divergence:** Human-Layer routes removed from mount list
  per DP-7 (`04-deferred.md §5`).

---

## 6. Kind registry

**Purpose:** Hold the open directory of application-layer kinds
recognised by AgentXP relays, with payload schema references and
stability markers.
**Package:** `kind-registry/`.
**Interfaces consumed:** none at runtime; consulted at
build-time / PR-review-time by humans and CI.

**Contract:**

- **MUST** list exactly one kind with status `stable-mvp`:
  `io.agentxp.experience` (DP-2).
- **MUST** require every entry to carry: `name`, `owner`,
  `payload_schema_url`, `status`, `created_at`.
- **SHOULD** reject PRs adding kinds whose `name` is not
  reverse-domain-formatted.
- **MUST NOT** grant SPEC contract status by registration alone;
  promotion into MVP SPEC requires an ADR per
  `04-deferred.md §6`.
- Relays **MAY** accept events bearing registered kinds with
  status other than `stable-mvp`; such acceptance creates no
  contract obligation.

**Acceptance cases:**

1. *Happy —* A PR adding `com.example.newkind` with all required
   fields and `status: experimental` passes CI and merges; the
   kind appears in the machine-readable manifest.
2. *Edge —* Two PRs race to register the same `name`; the second
   is rejected by CI conflict detection.
3. *Error —* A PR omitting `payload_schema_url` is rejected by
   CI with an error message naming the missing field.

**Legacy Reference:**

- **Primary:** existing `kind-registry/README.md` — current
  conventions.
- **Related:** `legacy/docs/plans/2026-04-12-agentxp-v4-design.md`
  §Kind system.
- **Divergence:** single MVP-stable kind (DP-2) instead of the
  multi-kind cold-start set (now `04-deferred.md §4`).

---

## Cross-cutting invariants

These apply to **every** module in both `03-modules-platform.md`
and `03-modules-product.md`:

- **Signatures everywhere.** Any state-changing HTTP request
  **MUST** be backed by a signed Serendip event; anonymous writes
  **MUST** return `401`.
- **Event log before derived view.** Every module that persists
  must obey the ordering in `02-data-model.md §8 (I1–I4)`.
- **No silent mutation.** Corrections are always new events; no
  MVP module **MAY** mutate a stored event or derived-view row
  tied to a specific event.
- **Payload limit.** The 64 KiB limit applies at both the
  protocol library (module #1) and the relay (module #2); both
  enforcement points **MUST** agree.
- **Deferred isolation.** No MVP module **MAY** call into a
  deferred module (see `04-deferred.md`) as part of fulfilling
  its own contract. Deferred code **MAY** call into MVP modules
  freely.

