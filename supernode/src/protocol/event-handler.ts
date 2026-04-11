// Supernode — Event Receive & Verify
// Accepts events via WebSocket + HTTP POST /api/v1/events
// Verifies Ed25519 signatures, deduplicates by event.id, scans for injection.

import { Database } from 'bun:sqlite'
import { verifyEvent, type SerendipEvent } from '@serendip/protocol'
import { validatePayloadSize, scanForPromptInjection, validateTags, validateTimestamp, validatePubkey } from '../validate'
import { IdentityStore } from './identity-store'
import { logger } from '../logger'

export interface EventHandlerResult {
  ok: boolean
  error?: string
  stored?: boolean
}

export class EventHandler {
  private identityStore: IdentityStore

  constructor(private db: Database) {
    this.identityStore = new IdentityStore(db)
  }

  /** Process an incoming event. Returns ok:true if accepted. */
  async handleEvent(event: unknown): Promise<EventHandlerResult> {
    // 1. Basic structure validation
    const structResult = validateEventStructure(event)
    if (!structResult.ok) return structResult

    const ev = event as SerendipEvent

    // 2. Payload size check (64KB max)
    const sizeResult = validatePayloadSize(ev.payload)
    if (!sizeResult.valid) {
      return { ok: false, error: sizeResult.error }
    }

    // 3. Tag validation
    const tagResult = validateTags(ev.tags)
    if (!tagResult.valid) {
      return { ok: false, error: tagResult.error }
    }

    // 4. Timestamp validation
    const tsResult = validateTimestamp(ev.created_at)
    if (!tsResult.valid) {
      return { ok: false, error: tsResult.error }
    }

    // 5. Pubkey format validation
    const pubkeyResult = validatePubkey(ev.pubkey)
    if (!pubkeyResult.valid) {
      return { ok: false, error: pubkeyResult.error }
    }

    // 6. Prompt injection scan on text fields
    const injectionResult = scanForPromptInjection(ev.payload)
    if (!injectionResult.valid) {
      logger.warn('Prompt injection rejected', {
        event_id: ev.id,
        pubkey: ev.pubkey,
        error: injectionResult.error,
      })
      return { ok: false, error: injectionResult.error }
    }

    // 7. Ed25519 signature verification
    const valid = await verifyEvent(ev)
    if (!valid) {
      logger.warn('Invalid signature', { event_id: ev.id, pubkey: ev.pubkey })
      return { ok: false, error: 'invalid signature' }
    }

    // 8. Revocation pre-check
    if (this.identityStore.isRevoked(ev.pubkey)) {
      return { ok: false, error: 'key revoked' }
    }

    // 9. Deduplication: reject replay attacks
    const existing = this.db
      .query('SELECT id FROM events WHERE id = ?')
      .get(ev.id)
    if (existing) {
      return { ok: false, error: 'duplicate event id (replay rejected)' }
    }

    // 10. Store the event
    try {
      this.db
        .prepare(`
          INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          ev.id,
          ev.pubkey,
          ev.operator_pubkey,
          ev.kind,
          ev.created_at,
          JSON.stringify(ev.payload),
          JSON.stringify(ev.tags),
          ev.visibility,
          ev.sig,
          Math.floor(Date.now() / 1000)
        )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Failed to store event', { event_id: ev.id, error: msg })
      return { ok: false, error: `storage failed: ${msg}` }
    }

    // 11. Handle identity events
    if (ev.kind === 'identity.register') {
      this.identityStore.handleRegister(ev)
    } else if (ev.kind === 'identity.delegate') {
      this.identityStore.handleDelegate(ev)
    } else if (ev.kind === 'identity.revoke') {
      this.identityStore.handleRevoke(ev)
    }

    logger.info('Event accepted', {
      event_id: ev.id,
      pubkey: ev.pubkey,
      event_kind: ev.kind,
    })

    return { ok: true, stored: true }
  }
}

/** Validate basic event envelope structure. */
function validateEventStructure(event: unknown): EventHandlerResult {
  if (!event || typeof event !== 'object') {
    return { ok: false, error: 'event must be an object' }
  }

  const ev = event as Record<string, unknown>

  if (ev['v'] !== 1) {
    return { ok: false, error: 'unsupported protocol version' }
  }

  const requiredFields = ['id', 'pubkey', 'operator_pubkey', 'kind', 'created_at', 'payload', 'tags', 'sig']
  for (const field of requiredFields) {
    if (ev[field] === undefined) {
      return { ok: false, error: `missing required field: ${field}` }
    }
  }

  return { ok: true }
}
