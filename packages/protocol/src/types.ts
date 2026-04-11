// Serendip Protocol — Core Types
// Protocol layer only. No application-layer (experience.*) kinds here.

// ─────────────────────────────────────────────────────────────
// Protocol-layer kinds
// ─────────────────────────────────────────────────────────────

/** Protocol-layer intent kinds. Never includes application kinds like 'experience.*'. */
export type IntentKind =
  | 'intent.broadcast'
  | 'intent.match'
  | 'intent.verify'
  | 'intent.subscribe'

/** Protocol-layer identity kinds. */
export type IdentityKind =
  | 'identity.register'
  | 'identity.delegate'
  | 'identity.revoke'

/** Union of all protocol-layer kinds. */
export type SerendipKind = IntentKind | IdentityKind

// ─────────────────────────────────────────────────────────────
// Event envelope
// ─────────────────────────────────────────────────────────────

/**
 * Minimal event envelope. The protocol does not care about payload contents —
 * that is the application layer's responsibility.
 */
export interface SerendipEvent {
  /** Protocol version. Always 1 in this version. */
  v: 1
  /** SHA-256 hash of canonical content (hex, 64 chars). */
  id: string
  /** Publisher Agent public key (Ed25519, hex, 64 chars). */
  pubkey: string
  /** Unix timestamp (seconds). */
  created_at: number
  /** Event kind — protocol-layer only. */
  kind: SerendipKind
  /** Application-defined payload. Protocol treats this as opaque. */
  payload: IntentPayload
  /** Free-form string tags for filtering. */
  tags: string[]
  /** Visibility scope. */
  visibility: 'public' | 'private'
  /** Operator master key public key (hex, 64 chars). */
  operator_pubkey: string
  /** Ed25519 signature of id (hex, 128 chars). */
  sig: string
}

// ─────────────────────────────────────────────────────────────
// Payload types
// ─────────────────────────────────────────────────────────────

/**
 * Generic intent payload. Protocol does not define or constrain what `data` contains.
 * Applications extend this interface.
 */
export interface IntentPayload {
  /** Application-defined type string (e.g. 'experience', 'capability'). */
  type: string
  data: unknown
}

// ─────────────────────────────────────────────────────────────
// AgentXP application-layer types (experience)
// ─────────────────────────────────────────────────────────────

/** Optional validity scope for an experience. */
export interface ExperienceScope {
  /** Version constraints, e.g. ['docker>=24', 'bun>=1.0']. */
  versions?: string[]
  /** Platforms this experience applies to, e.g. ['linux', 'macos']. */
  platforms?: string[]
  /** Deployment context, e.g. 'production', 'development'. */
  context?: string
}

/** Structured data for an experience event. */
export interface ExperienceData {
  /** Short description of what was attempted. */
  what: string
  /** Specific action taken. */
  tried: string
  /** Outcome of the attempt. */
  outcome: 'succeeded' | 'failed' | 'partial' | 'inconclusive'
  /** Actionable lesson learned. */
  learned: string
  /** Optional scope describing where this experience applies. */
  scope?: ExperienceScope
}

/**
 * AgentXP application-layer payload for experience events.
 * Maps to: intent.broadcast with payload.type='experience'
 */
export interface ExperiencePayload extends IntentPayload {
  type: 'experience'
  data: ExperienceData
}

// ─────────────────────────────────────────────────────────────
// Identity / Key types
// ─────────────────────────────────────────────────────────────

/** Operator master key — long-term, used offline. Controls all Agent sub-keys. */
export interface OperatorKey {
  /** Ed25519 public key (hex, 64 chars). */
  publicKey: string
  /** Ed25519 private key (32 bytes). */
  privateKey: Uint8Array
}

/**
 * Agent sub-key — daily operations. Delegated from an OperatorKey.
 * In solo-developer mode: same private key as operator, delegatedBy = own pubkey.
 */
export interface AgentKey {
  /** Ed25519 public key (hex, 64 chars). */
  publicKey: string
  /** Ed25519 private key (32 bytes). */
  privateKey: Uint8Array
  /** Operator public key that issued this delegation (hex, 64 chars). */
  delegatedBy: string
  /** Unix timestamp when this key expires. */
  expiresAt: number
  /** Optional human-readable agent identifier. */
  agentId?: string
}
