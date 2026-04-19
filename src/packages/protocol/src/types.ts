// Serendip Protocol v1 — core types.
// Normative sources:
//   - docs/spec/02-data-model.md §1-§5
//   - legacy/docs/spec/serendip-protocol-v1.md (still normative per HISTORY.md §1)
//   - legacy/docs/plans/2026-04-12-phase-a-tdd-spec.md §A1 (adopted; HISTORY.md §2)

// -----------------------------------------------------------------
// Protocol-layer kinds (02-data-model.md §2)
// -----------------------------------------------------------------

export type IntentKind =
  | 'intent.broadcast'
  | 'intent.match'
  | 'intent.verify'
  | 'intent.subscribe'

export type IdentityKind =
  | 'identity.register'
  | 'identity.delegate'
  | 'identity.revoke'

export type SerendipKind = IntentKind | IdentityKind

// -----------------------------------------------------------------
// Wire envelope (02-data-model.md §1)
// -----------------------------------------------------------------

export interface SerendipEvent {
  v: 1
  id: string
  pubkey: string
  created_at: number
  kind: SerendipKind
  payload: IntentPayload
  tags: string[]
  visibility: 'public' | 'private'
  operator_pubkey: string
  sig: string
}

// -----------------------------------------------------------------
// Payload base (02-data-model.md §3; §5 identity payloads live alongside)
// -----------------------------------------------------------------

export interface IntentPayload {
  type: string
  data: unknown
}

// -----------------------------------------------------------------
// Experience payload (02-data-model.md §3)
// -----------------------------------------------------------------

export interface ExperienceScope {
  versions?: string[]
  platforms?: string[]
  context?: string
}

export interface ExperienceData {
  what: string
  tried: string
  outcome: 'succeeded' | 'failed' | 'partial' | 'inconclusive'
  learned: string
  scope?: ExperienceScope
}

export interface ExperiencePayload extends IntentPayload {
  type: 'experience'
  data: ExperienceData
  reasoning_trace?: unknown
  supersedes?: string
  extends?: string
  qualifies?: string
}

// -----------------------------------------------------------------
// Identity payloads (02-data-model.md §5)
// -----------------------------------------------------------------

export interface OperatorRegistrationPayload extends IntentPayload {
  type: 'operator'
  data: { pubkey: string; registered_at: number }
}

export interface DelegationPayload extends IntentPayload {
  type: 'delegation'
  data: { agent_pubkey: string; expires_at: number; agent_id?: string }
}

export interface RevocationPayload extends IntentPayload {
  type: 'revocation'
  data: { agent_pubkey: string; reason?: string }
}

// -----------------------------------------------------------------
// Identity keys (Phase A §A1)
// -----------------------------------------------------------------

export interface OperatorKey {
  publicKey: string
  privateKey: Uint8Array
}

export interface AgentKey {
  publicKey: string
  privateKey: Uint8Array
  delegatedBy: string
  expiresAt: number
  agentId?: string
}
