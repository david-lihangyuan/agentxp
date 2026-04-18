// Event intake pipeline. Per SPEC 03-modules-platform §2.
//
// 1. Structural validation.
// 2. 64 KiB payload limit (413).
// 3. Signature verification (401).
// 4. Kind-specific routing:
//    - identity.register  → identities row for the operator.
//    - identity.delegate  → identities row for the agent, delegated by signer.
//    - identity.revoke    → mark agent revoked.
//    - intent.broadcast   → experience or outcome; requires valid delegation.
// 5. Idempotent insert into events, then derived view write (I1→I2).
import { MAX_PAYLOAD_BYTES, verifyEvent } from '@serendip/protocol'
import type {
  DelegationPayload,
  ExperienceData,
  ExperiencePayload,
  OperatorRegistrationPayload,
  RevocationPayload,
  SerendipEvent,
} from '@serendip/protocol'
import type { Db } from './db.js'
import { insertEvent } from './event-store.js'
import { insertExperience } from './experience-store.js'
import {
  checkDelegation,
  delegateAgent,
  registerOperator,
  revokeAgent,
} from './identity-store.js'

export type IngestResult =
  | { ok: true; event_id: string; received_at: number; duplicate: boolean }
  | { ok: false; status: 400 | 401 | 403 | 413; error: string; field?: string }

function payloadBytes(event: SerendipEvent): number {
  return new TextEncoder().encode(JSON.stringify(event.payload)).length
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function validateExperienceData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return 'data'
  const d = data as Partial<ExperienceData>
  if (!isNonEmptyString(d.what)) return 'data.what'
  if (!isNonEmptyString(d.tried)) return 'data.tried'
  if (!isNonEmptyString(d.learned)) return 'data.learned'
  if (
    d.outcome !== 'succeeded' &&
    d.outcome !== 'failed' &&
    d.outcome !== 'partial' &&
    d.outcome !== 'inconclusive'
  ) {
    return 'data.outcome'
  }
  return null
}

export async function ingestEvent(db: Db, event: SerendipEvent): Promise<IngestResult> {
  if (payloadBytes(event) > MAX_PAYLOAD_BYTES) {
    return { ok: false, status: 413, error: 'payload_too_large' }
  }
  const verified = await verifyEvent(event)
  if (!verified) {
    return { ok: false, status: 401, error: 'signature_invalid' }
  }

  const now = Math.floor(Date.now() / 1000)

  if (event.kind === 'identity.register') {
    const p = event.payload as OperatorRegistrationPayload
    if (p.type !== 'operator' || !isNonEmptyString(p.data?.pubkey)) {
      return { ok: false, status: 400, error: 'invalid_payload', field: 'payload' }
    }
    if (p.data.pubkey !== event.pubkey) {
      return { ok: false, status: 400, error: 'pubkey_mismatch', field: 'payload.data.pubkey' }
    }
    const duplicate = !insertEvent(db, event, now)
    if (!duplicate) registerOperator(db, p.data.pubkey, event.created_at)
    return { ok: true, event_id: event.id, received_at: now, duplicate }
  }

  if (event.kind === 'identity.delegate') {
    const p = event.payload as DelegationPayload
    if (
      p.type !== 'delegation' ||
      !isNonEmptyString(p.data?.agent_pubkey) ||
      typeof p.data.expires_at !== 'number'
    ) {
      return { ok: false, status: 400, error: 'invalid_payload', field: 'payload' }
    }
    const duplicate = !insertEvent(db, event, now)
    if (!duplicate) {
      registerOperator(db, event.pubkey, event.created_at)
      delegateAgent(
        db,
        p.data.agent_pubkey,
        event.pubkey,
        p.data.expires_at,
        event.created_at,
        p.data.agent_id,
      )
    }
    return { ok: true, event_id: event.id, received_at: now, duplicate }
  }

  if (event.kind === 'identity.revoke') {
    const p = event.payload as RevocationPayload
    if (p.type !== 'revocation' || !isNonEmptyString(p.data?.agent_pubkey)) {
      return { ok: false, status: 400, error: 'invalid_payload', field: 'payload' }
    }
    const duplicate = !insertEvent(db, event, now)
    if (!duplicate) revokeAgent(db, p.data.agent_pubkey, event.created_at)
    return { ok: true, event_id: event.id, received_at: now, duplicate }
  }

  if (event.kind === 'intent.broadcast') {
    const delegation = checkDelegation(db, event.pubkey, event.operator_pubkey, event.created_at)
    if (!delegation.ok) {
      const status = delegation.reason === 'unknown_agent' ? 401 : 403
      return { ok: false, status, error: delegation.reason }
    }
    const payload = event.payload as ExperiencePayload
    if (payload.type === 'experience') {
      const missing = validateExperienceData(payload.data)
      if (missing) {
        return { ok: false, status: 400, error: 'invalid_experience', field: missing }
      }
      const duplicate = !insertEvent(db, event, now)
      if (!duplicate) insertExperience(db, event)
      return { ok: true, event_id: event.id, received_at: now, duplicate }
    }
    // Other payload types (e.g. 'outcome' for POST /pulse/outcome) are
    // accepted at event-log level only.
    const duplicate = !insertEvent(db, event, now)
    return { ok: true, event_id: event.id, received_at: now, duplicate }
  }

  // intent.match / intent.verify / intent.subscribe — accepted as raw log.
  const duplicate = !insertEvent(db, event, now)
  return { ok: true, event_id: event.id, received_at: now, duplicate }
}
