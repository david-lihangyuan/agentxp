// Human Layer — Signed-request verification
// The mutating human-layer routes (letter, contribute) require the request body
// to be a full SerendipEvent envelope signed by the operator. This module
// enforces that contract. The operator must sign directly — we do not verify
// agent-key delegation chains here.

import { verifyEvent } from '@serendip/protocol'
import type { SerendipEvent } from '@serendip/protocol'
import { PUBKEY_PATTERN } from '../../validate'

export type VerifyOperatorEventResult =
  | { ok: true; event: SerendipEvent }
  | { ok: false; error: string; status: 400 | 401 }

/**
 * Verify that a request body is a signed SerendipEvent authorized by the
 * given operator. The body must be `{ event: <SerendipEvent> }`. All of:
 *   1. event shape is plausible (all required fields, hex pubkeys)
 *   2. event.kind matches the expected kind
 *   3. event.operator_pubkey === expectedOperatorPubkey
 *   4. event.pubkey === event.operator_pubkey (operator signs directly)
 *   5. verifyEvent passes: id matches canonical hash, Ed25519 sig is valid
 */
export async function verifyOperatorEvent(
  body: unknown,
  expectedOperatorPubkey: string,
  expectedKind: string,
): Promise<VerifyOperatorEventResult> {
  if (!body || typeof body !== 'object' || !('event' in body)) {
    return { ok: false, status: 400, error: 'missing event envelope' }
  }
  const candidate = (body as { event: unknown }).event
  if (!isPlausibleEvent(candidate)) {
    return { ok: false, status: 400, error: 'invalid event envelope' }
  }
  if (candidate.kind !== expectedKind) {
    return { ok: false, status: 400, error: `expected kind '${expectedKind}'` }
  }
  if (candidate.operator_pubkey !== expectedOperatorPubkey) {
    return { ok: false, status: 401, error: 'operator_pubkey does not match URL' }
  }
  if (candidate.pubkey !== candidate.operator_pubkey) {
    return { ok: false, status: 401, error: 'operator must sign directly (pubkey !== operator_pubkey)' }
  }
  const valid = await verifyEvent(candidate)
  if (!valid) {
    return { ok: false, status: 401, error: 'invalid signature' }
  }
  return { ok: true, event: candidate }
}

function isPlausibleEvent(v: unknown): v is SerendipEvent {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (
    e['v'] === 1 &&
    typeof e['id'] === 'string' &&
    typeof e['pubkey'] === 'string' && PUBKEY_PATTERN.test(e['pubkey']) &&
    typeof e['operator_pubkey'] === 'string' && PUBKEY_PATTERN.test(e['operator_pubkey']) &&
    typeof e['created_at'] === 'number' &&
    typeof e['kind'] === 'string' &&
    typeof e['sig'] === 'string' &&
    typeof e['payload'] === 'object' && e['payload'] !== null &&
    Array.isArray(e['tags']) &&
    (e['visibility'] === 'public' || e['visibility'] === 'private')
  )
}
