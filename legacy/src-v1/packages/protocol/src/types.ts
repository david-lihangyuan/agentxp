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

/**
 * Application-layer kinds registered in the kind-registry.
 * Third-party kinds follow reverse-domain naming: 'com.example.mykind'
 */
export type ApplicationKind =
  | 'io.agentxp.experience'
  | 'io.agentxp.capability'
  | 'io.agentxp.verification'
  | (string & {}) // allow arbitrary third-party kinds without type errors

/** Union of all known kinds (protocol + application). */
export type SerendipKind = IntentKind | IdentityKind | ApplicationKind

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

// ─────────────────────────────────────────────────────────────
// L2 Reasoning Trace types
// ─────────────────────────────────────────────────────────────

/** Standard action labels for reasoning steps (#18). */
export type TraceAction =
  | 'observe'
  | 'hypothesize'
  | 'investigate'
  | 'decide'
  | 'verify'
  | 'backtrack'
  | 'delegate'
  | 'conclude'

/** Significance level of a reasoning step (#13). */
export type StepSignificance = 'key' | 'routine' | 'context'

/** A single reasoning step within a trace. */
export interface TraceStep {
  action: TraceAction
  /** Raw free-text action label preserved from the original input. */
  action_raw?: string
  content: string
  significance: StepSignificance
  /** Experience IDs referenced in this step (#25). */
  references?: string[]
}

/** Record of an abandoned investigation path (#2, #22). */
export interface DeadEnd {
  step_index: number
  tried: string
  why_abandoned: string
  /** Controls whether this dead-end is shared publicly (#2). */
  sensitivity_class: 'public' | 'restricted'
}

/** Before/after difficulty comparison for a task (#11). */
export interface DifficultyAssessment {
  estimated: 'trivial' | 'easy' | 'medium' | 'hard' | 'extreme'
  actual: 'trivial' | 'easy' | 'medium' | 'hard' | 'extreme'
  /** How surprising the actual difficulty was. Range: 0.0–1.0. */
  surprise_factor: number
}

/** Domain fingerprint for retrieval and security filtering (#4). */
export interface DomainFingerprint {
  ecosystem: string
  layer: 'infra' | 'api' | 'ui' | 'config' | 'security' | 'other'
  languages: string[]
  frameworks: string[]
  error_class?: 'compile' | 'runtime' | 'config' | 'logic' | 'security'
}

/** Tool and environment prerequisites needed to reproduce a trace (#14). */
export interface Prerequisites {
  /** Generalised tool categories, e.g. shell, network, file_ops, code_edit, browser. */
  tools_required: string[]
  access_level: 'none' | 'user' | 'admin' | 'server_admin'
  environment: string[]
}

/** Software version window in which an experience applies (#15). */
export interface VersionContext {
  software: string
  /** Inclusive range string, e.g. "4.11-4.13". */
  version_range: string
}

/** Complete reasoning trace attached to an experience. */
export interface ReasoningTrace {
  steps: TraceStep[]
  dead_ends: DeadEnd[]
  /** One-sentence summary of the trace (#16). */
  trace_summary: string
  /** Solver confidence. Range: 0.0–1.0 (#6). */
  confidence: number
  /** Coarse time bucket for how long the task took (#7). */
  duration_bucket: 'under_1min' | '1_to_5min' | '5_to_15min' | 'over_15min'
  /** Generalised tool categories used (#8). */
  tools_used_category: string[]
  /** Snapshot of the situation at trace start (#9). */
  context_at_start: string
  prerequisites: Prerequisites
  version_context?: VersionContext
  difficulty: DifficultyAssessment
  domain_fingerprint: DomainFingerprint
  /** Whether this trace is worth storing and propagating (#22). */
  trace_worthiness: 'low' | 'high'
  /** How reproducible the outcome is (#20). */
  reproducibility: 'deterministic' | 'env_dependent' | 'state_dependent'
  /** Parent trace ID for hierarchical traces (#12). */
  parent_trace_id?: string
  /** Question/task this trace was created in response to (#19). */
  question_id?: string
  /** ISO date hint for when this experience may expire (#15). */
  expires_hint?: string
}

/** Consumer feedback on a propagated trace (#17). */
export interface TraceFeedback {
  trace_id: string
  consumer_pubkey: string
  applied: boolean
  outcome: 'success' | 'partial' | 'failed'
  notes?: string
  /** Perceived cross-context transferability. Range: 0.0–1.0 (#23). */
  transferability_perceived?: number
  created_at: number
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
