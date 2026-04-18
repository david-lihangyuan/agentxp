# ADR-003 — Event canonical serialization and signEvent API (provisional)

- Date: 2026-04-18
- Status: **PROVISIONAL** (adopted for `feat/v0.1-impl` M1)
- Related: `docs/spec/02-data-model.md §1.1`;
  `docs/spec/03-modules-platform.md §1`;
  `legacy/docs/spec/serendip-protocol-v1.md §Canonicalization` (still normative per `HISTORY.md §1`);
  `legacy/docs/plans/2026-04-12-phase-a-tdd-spec.md §A3`
- Supersedes: —

## Context

M1 ("`@serendip/protocol`") must implement `signEvent` / `verifyEvent`
and the canonical `eventId`. Two authoritative documents disagree on
how the canonical byte sequence is constructed:

1. `legacy/docs/spec/serendip-protocol-v1.md:104–119` defines the
   canonical form as a 5-element JSON array
   `[0, "<pubkey>", <created_at>, "<kind>", <payload>]`.
2. `docs/spec/02-data-model.md §1.1` states
   `id = sha256(canonical_bytes(event_without_sig))` — suggesting the
   entire envelope minus `sig` (and, transitively, `id`).

The legacy reference implementation
(`legacy/src-v1/packages/protocol/src/events.ts:53-73`) picked (2):
sort keys recursively, drop `id` and `sig`, encode as whitespace-free
JSON. This covers `v`, `pubkey`, `created_at`, `kind`, `payload`,
`tags`, `visibility`, `operator_pubkey` under the signature.

Similarly, `03-modules-platform.md §1` writes `signEvent(payload,
privateKey): SerendipEvent` as a one-line summary, while the
`Legacy Reference: Divergence: none` entry in that same section binds
the concrete API to Phase A's
`signEvent(event: Omit<SerendipEvent, 'sig' | 'id'>, agentKey: AgentKey)`.

## Decision

### D1. Canonical byte sequence

`@serendip/protocol` computes the canonical byte sequence as the
**recursively sorted-keys, whitespace-free JSON** serialisation of the
SerendipEvent with `id` and `sig` removed. Concretely:

```
canonical_bytes(e) = UTF-8( sortedJSON({ v, pubkey, created_at, kind,
                                         payload, tags, visibility,
                                         operator_pubkey }) )
id                 = lowercase_hex( sha256( canonical_bytes(e) ) )
sig                = lowercase_hex( ed25519_sign(privkey,
                                                 hex_decode(id)) )
```

Where `sortedJSON` sorts object keys lexicographically at every depth
(including inside `payload`), serialises arrays element-wise, and emits
no inter-token whitespace.

Rationale:

- Matches the legacy reference implementation, which is the only
  corpus of pre-existing signed events the MVP will interoperate with
  once published.
- Covers `v`, `tags`, `visibility`, `operator_pubkey` under the
  signature; the tuple form in the protocol spec leaves those fields
  un-authenticated and lets a relay or MITM mutate them silently.
- The phrase `canonical_bytes(event_without_sig)` in
  `02-data-model.md §1.1` reads naturally as this form.

The 5-tuple form in `serendip-protocol-v1.md §Canonicalization` is
treated as **aspirational pre-implementation text**, never realised by
any running relay. A future protocol revision that wants to formalise
the tuple form must produce a new protocol version
(`serendip-protocol-v2`) per `00-overview.md §10`.

### D2. `signEvent` signature

The concrete TypeScript signature exported by `@serendip/protocol` is:

```ts
signEvent(
  event: Omit<SerendipEvent, 'sig' | 'id'>,
  agentKey: AgentKey,
): Promise<SerendipEvent>
```

The one-line `signEvent(payload, privateKey)` in
`03-modules-platform.md §1` is read as a summary abstraction; the
binding contract is Phase A §A3 (HISTORY.md §2: "Divergence: None").

`signEvent` additionally:

- **MUST** throw `PayloadTooLargeError` when the UTF-8 byte length of
  `JSON.stringify(event.payload)` exceeds 65 536 (SPEC 02-data-model
  §1.1 + 03-modules-platform §1 acceptance 2).
- **MUST** throw `InvalidKindError` when `event.kind` is not one of
  the seven protocol-layer kinds enumerated in Phase A §A1.

### D3. `verifyEvent` signature

```ts
verifyEvent(event: SerendipEvent): Promise<boolean>
```

Returns `false` on any mismatch (id recomputation, signature
verification). **MUST NOT** throw (03-modules-platform §1 acceptance 3).

## Provenance flag

This ADR is authored to unblock M1 implementation. It is PROVISIONAL
and MAY be revised without a supersession ADR by editing the Status
and Revisit triggers fields; a new ADR is required only if D1 or D2
is *reversed* in a way that breaks wire compatibility with already-
signed events.

## Revisit triggers

1. A second protocol version (`serendip-protocol-v2`) is drafted and
   formalises either the tuple form or a third alternative.
2. `docs/spec/02-data-model.md §1.1` is edited to explicitly name a
   serialisation that differs from D1.
3. A cross-implementation interop test against a non-AgentXP Serendip
   relay surfaces a canonicalization disagreement.
4. The project lead reopens the question.

## Consequences

- `src/packages/protocol/src/canonical.ts` implements `sortedJSON` and
  `sha256hex` per D1.
- `src/packages/protocol/src/events.ts` exports `signEvent` /
  `verifyEvent` per D2 / D3, plus `createEvent` (Phase A A3 helper).
- A short citation `// Ported from legacy/src-v1/packages/protocol/
  src/events.ts:…` accompanies ported algorithm blocks, per
  `.augment/rules/project.md §2`.
- Relay M2 (`supernode/src/protocol/event-handler.ts`) reuses
  `verifyEvent` from `@serendip/protocol`; no independent canonical
  form lives on the relay side.
