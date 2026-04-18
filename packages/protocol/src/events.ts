// Serendip Protocol — Event creation, signing, and verification
import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import type { SerendipEvent, SerendipKind, IntentPayload, AgentKey } from './types.js'
import { bytesToHex, hexToBytes } from './utils.js'

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

/** Compute SHA-256 of a UTF-8 string, return hex. */
function sha256hex(input: string): string {
  const encoded = new TextEncoder().encode(input)
  return bytesToHex(sha256(encoded))
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Create an unsigned event envelope.
 * The returned event has no `sig` or `id` — call signEvent to add them.
 *
 * @param kind - Protocol-layer event kind
 * @param payload - Application-defined payload
 * @param tags - Free-form string tags for relay filtering
 */
export function createEvent(
  kind: SerendipKind,
  payload: IntentPayload,
  tags: string[]
): Omit<SerendipEvent, 'sig' | 'id' | 'pubkey' | 'operator_pubkey'> {
  return {
    v: 1,
    created_at: Math.floor(Date.now() / 1000),
    kind,
    payload,
    tags,
    visibility: 'public',
  }
}

/**
 * Produce a deterministic canonical JSON string from an event.
 * Rules:
 *   - Keys sorted lexicographically
 *   - No whitespace
 *   - `id` and `sig` fields excluded (they depend on this computation)
 *
 * @param event - Partial event (id and sig are ignored if present)
 */
export function canonicalize(event: Partial<SerendipEvent>): string {
  // Build an object without id and sig, then sort keys recursively
  const { id: _id, sig: _sig, ...rest } = event as SerendipEvent
  void _id
  void _sig
  return sortedJSON(rest)
}

/** Recursively sort keys and stringify. */
function sortedJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(sortedJSON).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${sortedJSON(obj[k])}`)
  return '{' + pairs.join(',') + '}'
}

/**
 * Sign an unsigned event with an Agent sub-key.
 * Computes id = SHA-256(canonicalize(event)), then signs id with the agent's Ed25519 key.
 *
 * @param event - Unsigned event (from createEvent)
 * @param agentKey - Agent key to sign with
 */
export async function signEvent(
  event: Omit<SerendipEvent, 'sig' | 'id' | 'pubkey' | 'operator_pubkey'>,
  agentKey: AgentKey
): Promise<SerendipEvent> {
  // Attach pubkey and operator_pubkey before canonicalizing
  const withKeys = {
    ...event,
    pubkey: agentKey.publicKey,
    operator_pubkey: agentKey.delegatedBy,
  }

  const canonical = canonicalize(withKeys)
  const id = sha256hex(canonical)
  const idBytes = hexToBytes(id)
  const sigBytes = ed25519.sign(idBytes, agentKey.privateKey)
  const sig = bytesToHex(sigBytes)

  return { ...withKeys, id, sig }
}

/**
 * Verify a signed SerendipEvent.
 * Checks:
 *   1. id matches SHA-256 of canonical content (excluding id + sig)
 *   2. sig is a valid Ed25519 signature of id using event.pubkey
 *
 * Never throws — returns false on any error.
 * NOTE: Key expiry is NOT checked here. That is the relay's responsibility.
 *
 * @param event - Fully signed event
 */
export async function verifyEvent(event: SerendipEvent): Promise<boolean> {
  try {
    // Step 1: recompute canonical content without id/sig, reattach pubkeys
    const { id, sig, ...rest } = event
    const canonical = canonicalize(rest)
    const expectedId = sha256hex(canonical)

    // Step 2: id must match
    if (id !== expectedId) {
      return false
    }

    // Step 3: verify Ed25519 signature
    const idBytes = hexToBytes(id)
    const sigBytes = hexToBytes(sig)
    const pubkeyBytes = hexToBytes(event.pubkey)

    return ed25519.verify(sigBytes, idBytes, pubkeyBytes)
  } catch {
    return false
  }
}
