// createEvent / signEvent / verifyEvent.
// Per docs/spec/03-modules-platform.md §1 and ADR-003.
// Ported from legacy/src-v1/packages/protocol/src/events.ts:29-134.
import { ed25519 } from '@noble/curves/ed25519'
import type { AgentKey, IntentPayload, SerendipEvent, SerendipKind } from './types.js'
import { canonicalize, sha256hex } from './canonical.js'
import { InvalidKindError, PayloadTooLargeError } from './errors.js'
import { bytesToHex, hexToBytes } from './utils.js'

/**
 * 64 KiB payload limit. SPEC 02-data-model.md §1.1 and
 * 03-modules-platform.md §1 acceptance 2.
 */
export const MAX_PAYLOAD_BYTES = 65_536

const PROTOCOL_KINDS: ReadonlySet<SerendipKind> = new Set<SerendipKind>([
  'intent.broadcast',
  'intent.match',
  'intent.verify',
  'intent.subscribe',
  'identity.register',
  'identity.delegate',
  'identity.revoke',
])

function assertKind(kind: string): asserts kind is SerendipKind {
  if (!PROTOCOL_KINDS.has(kind as SerendipKind)) {
    throw new InvalidKindError(kind)
  }
}

/**
 * Construct an unsigned event envelope. The returned shape omits
 * `id`, `sig`, `pubkey`, and `operator_pubkey`; those are filled in
 * by signEvent from the signing AgentKey.
 */
export function createEvent(
  kind: SerendipKind,
  payload: IntentPayload,
  tags: string[],
  createdAt?: number,
): Omit<SerendipEvent, 'sig' | 'id' | 'pubkey' | 'operator_pubkey'> {
  assertKind(kind)
  return {
    v: 1,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    kind,
    payload,
    tags,
    visibility: 'public',
  }
}

/**
 * Sign an unsigned event with an AgentKey. Throws:
 * - PayloadTooLargeError if the payload's UTF-8 JSON byte length
 *   exceeds MAX_PAYLOAD_BYTES (SPEC 02-data-model §1.1).
 * - InvalidKindError if the event's kind is not a protocol-layer kind
 *   (defence in depth; createEvent already checks).
 */
export async function signEvent(
  event: Omit<SerendipEvent, 'sig' | 'id' | 'pubkey' | 'operator_pubkey'>,
  agentKey: AgentKey,
): Promise<SerendipEvent> {
  assertKind(event.kind)

  const payloadBytes = new TextEncoder().encode(JSON.stringify(event.payload)).length
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    throw new PayloadTooLargeError(payloadBytes, MAX_PAYLOAD_BYTES)
  }

  const withKeys = {
    ...event,
    pubkey: agentKey.publicKey,
    operator_pubkey: agentKey.delegatedBy,
  }

  const canonical = canonicalize(withKeys)
  const id = sha256hex(canonical)
  const sig = bytesToHex(ed25519.sign(hexToBytes(id), agentKey.privateKey))

  return { ...withKeys, id, sig }
}

/**
 * Verify an event's id and signature. Never throws; returns false on
 * any mismatch or structural error. Per SPEC 03-modules-platform §1
 * acceptance 3, key expiry / revocation is NOT checked here — that is
 * the relay's responsibility.
 */
export async function verifyEvent(event: SerendipEvent): Promise<boolean> {
  try {
    const { id, sig, ...rest } = event

    const expectedId = sha256hex(canonicalize(rest))
    if (id !== expectedId) return false

    const idBytes = hexToBytes(id)
    const sigBytes = hexToBytes(sig)
    const pubkeyBytes = hexToBytes(event.pubkey)

    return ed25519.verify(sigBytes, idBytes, pubkeyBytes)
  } catch {
    return false
  }
}
