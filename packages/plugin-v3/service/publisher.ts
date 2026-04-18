/**
 * publisher.ts — Publish reflections to relay (Phase E6)
 *
 * Flow:
 * 1. Query publishable reflections (not yet in published_log)
 * 2. Sanitize (reject high-risk content)
 * 3. Sign event using protocol/serendip.ts (ed25519)
 * 4. Publish to relay via HTTP POST /api/v1/events
 * 5. Retry with exponential backoff: 15min → 30min → 1h cap
 * 6. On success: update published_log with relay_event_id
 * 7. Pull pulse events from relay
 *
 * 2026-04-17 斯文+航远:
 *   - Rewrote to use real signing via protocol/serendip.ts
 *   - Fixed URL (/api/v1/broadcast → /api/v1/events)
 *   - Added v:1 protocol envelope field required by Relay validateEventStructure
 *   - Query filter fixed: `publishable=1` → `published=0 AND quality_score>0.5 AND visibility!='private'`
 */

import type { Db } from '../db.js'
import { sanitizeBeforePublish } from '../sanitize.js'
import { toSerendipEvent, type LocalReflection } from '../protocol/serendip.js'

export interface PublishResult {
  published: number
  retried: number
  blocked: number
}

export interface PluginConfig {
  relayUrl: string
  operatorPubkey: string
  agentKey: string // Private key for signing (hex string, 64 chars = 32 bytes)
}

/** Parse agent private key hex string into Uint8Array (32 bytes). */
function parseAgentKey(hex: string): Uint8Array | null {
  if (!hex || typeof hex !== 'string') return null
  const clean = hex.trim().replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) return null
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Publish pending reflections to relay.
 * Handles sanitization, signing, retry logic, and pulse event pulling.
 */
export async function publishPending(db: Db, config: PluginConfig): Promise<PublishResult> {
  const results: PublishResult = { published: 0, retried: 0, blocked: 0 }

  // Guard: must have signing key
  const agentKey = parseAgentKey(config.agentKey)
  if (!agentKey) {
    // No usable key — silently skip (caller should set skipPublish in that case)
    return results
  }
  if (!config.operatorPubkey || !/^[0-9a-f]{64}$/.test(config.operatorPubkey)) {
    return results
  }

  // 1. Query publishable reflections not yet successfully published.
  // Schema uses `published` (0=draft, 1=published). We treat
  // `quality_score > 0.5` + visibility != 'private' as "publishable".
  const pending = db.db.prepare(`
    SELECT * FROM reflections
    WHERE published = 0
      AND quality_score > 0.5
      AND visibility != 'private'
      AND id NOT IN (
        SELECT reflection_id 
        FROM published_log 
        WHERE relay_event_id IS NOT NULL
      )
  `).all() as any[]

  for (const reflection of pending) {
    // 2. Sanitize
    const sanitizeResult = sanitizeBeforePublish({
      title: reflection.title,
      tried: reflection.tried,
      outcome: reflection.outcome,
      learned: reflection.learned,
    })

    if (!sanitizeResult.safe) {
      results.blocked++
      // Log block reason with retry_count=999 to permanently skip
      const now = Date.now()
      db.db.prepare(`
        INSERT OR IGNORE INTO published_log (
          reflection_id, relay_event_id, pulse_state, published_at, retry_count, last_retry_at
        ) VALUES (?, NULL, 'dormant', ?, 999, ?)
      `).run(reflection.id, now, now)
      continue
    }

    // 3. Check retry backoff (avoid hammering the relay on failed rows)
    const retryInfo = db.db.prepare(`
      SELECT retry_count, last_retry_at 
      FROM published_log 
      WHERE reflection_id = ? AND relay_event_id IS NULL
    `).get(reflection.id) as { retry_count: number; last_retry_at: number } | undefined

    if (retryInfo) {
      // Skip permanently-blocked rows
      if (retryInfo.retry_count >= 999) continue
      // Exponential backoff: 15min → 30min → 1h cap
      const backoffMinutes = Math.min(15 * Math.pow(2, retryInfo.retry_count), 60)
      const backoffMs = backoffMinutes * 60 * 1000
      const elapsed = Date.now() - retryInfo.last_retry_at

      if (elapsed < backoffMs) {
        continue // Too soon to retry
      }
    }

    // 4. Build & sign event
    let signedEvent: any
    try {
      const localRef: LocalReflection = {
        id: reflection.id,
        title: reflection.title,
        tried: reflection.tried,
        expected: reflection.expected ?? null,
        outcome: reflection.outcome,
        learned: reflection.learned,
        why_wrong: reflection.why_wrong ?? null,
        tags: reflection.tags ? safeJsonArray(reflection.tags) : [],
        visibility: reflection.visibility || 'public',
        // created_at: serendip canonical uses seconds since epoch
        created_at: Math.floor((reflection.created_at ?? Date.now()) / 1000),
      }

      // serendip.ts now includes v:1 inside the canonical event.
      signedEvent = await toSerendipEvent(localRef, agentKey, config.operatorPubkey)
    } catch (err) {
      // Signing failed — treat as transient error, bump retry
      await recordRetry(db, reflection.id)
      results.retried++
      continue
    }

    // 5. Publish to relay
    try {
      const response = await fetch(`${config.relayUrl}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signedEvent),
      })

      if (response.ok) {
        const now = Date.now()

        // Success: mark reflection as published + insert published_log
        db.db.prepare(`UPDATE reflections SET published = 1, relay_event_id = ?, updated_at = ? WHERE id = ?`)
          .run(signedEvent.id, now, reflection.id)

        // Remove any prior retry record, then insert a success row.
        db.db.prepare(`DELETE FROM published_log WHERE reflection_id = ? AND relay_event_id IS NULL`)
          .run(reflection.id)
        db.db.prepare(`
          INSERT INTO published_log (
            reflection_id, relay_event_id, pulse_state, published_at, retry_count, last_retry_at
          ) VALUES (?, ?, 'dormant', ?, 0, NULL)
        `).run(reflection.id, signedEvent.id, now)

        results.published++
      } else {
        // HTTP error: increment retry count (including 400 validation errors —
        // these might be transient or caller bug; let retry loop surface the pattern)
        const body = await response.text().catch(() => '')
        // eslint-disable-next-line no-console
        console.log(`[agentxp-v3][publisher] HTTP ${response.status} reflection=${reflection.id} body=${body.slice(0,200)}`)
        await recordRetry(db, reflection.id)
        results.retried++
      }
    } catch (err) {
      // Network/signing error: increment retry count
      // eslint-disable-next-line no-console
      console.log(`[agentxp-v3][publisher] fetch/sign failed reflection=${reflection.id} err=${(err as Error)?.message ?? err}`)
      await recordRetry(db, reflection.id)
      results.retried++
    }
  }

  return results
}

/** Safely parse a JSON array string, returning [] on failure. */
function safeJsonArray(s: string): string[] {
  try {
    const parsed = JSON.parse(s)
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string')
  } catch { /* ignore */ }
  return []
}

/**
 * Record a retry attempt (increment retry_count, update last_retry_at).
 */
async function recordRetry(db: Db, reflectionId: number): Promise<void> {
  const now = Date.now()
  const existing = db.db.prepare(`
    SELECT id, retry_count 
    FROM published_log 
    WHERE reflection_id = ? AND relay_event_id IS NULL
  `).get(reflectionId) as { id: number; retry_count: number } | undefined

  if (existing) {
    db.db.prepare(`
      UPDATE published_log 
      SET retry_count = ?, last_retry_at = ? 
      WHERE id = ?
    `).run(existing.retry_count + 1, now, existing.id)
  } else {
    db.db.prepare(`
      INSERT INTO published_log (
        reflection_id, relay_event_id, pulse_state, published_at, retry_count, last_retry_at
      ) VALUES (?, NULL, 'dormant', ?, 1, ?)
    `).run(reflectionId, now, now)
  }
}

/** Pulse states tracked locally, in monotonic order. */
const PULSE_STATE_RANK: Record<string, number> = {
  dormant: 0,
  discovered: 1,
  verified: 2,
  propagating: 3,
}

type TrackedPulseState = 'discovered' | 'verified' | 'propagating'

interface PulseHighlight {
  event_id?: string
  type?: string
}

interface PulseResponse {
  highlights?: PulseHighlight[]
  summary?: string
  total?: number
}

/**
 * Pull pulse events from relay for published experiences and advance
 * published_log.pulse_state to the highest state seen, never downgrading.
 *
 * Response shape is `{ highlights, summary, total }`; each highlight has
 * `event_id` (protocol-level SHA-256 hex) which matches
 * published_log.relay_event_id. Non-state highlights such as
 * `resolved_hit` and `subscription_match` are ignored here.
 *
 * Exported for unit-testing.
 */
export async function pullPulseEvents(db: Db, config: PluginConfig): Promise<void> {
  try {
    const response = await fetch(
      `${config.relayUrl}/api/v1/pulse?pubkey=${encodeURIComponent(config.operatorPubkey)}`
    )
    if (!response.ok) return

    const body = (await response.json()) as PulseResponse
    const highlights = Array.isArray(body?.highlights) ? body.highlights : []
    if (highlights.length === 0) return

    // Aggregate: for each event_id, keep the highest-ranked tracked state.
    const maxStateByEvent = new Map<string, TrackedPulseState>()
    for (const h of highlights) {
      if (!h.event_id || typeof h.event_id !== 'string') continue
      const t = h.type
      if (t !== 'discovered' && t !== 'verified' && t !== 'propagating') continue
      const prev = maxStateByEvent.get(h.event_id)
      if (!prev || PULSE_STATE_RANK[t] > PULSE_STATE_RANK[prev]) {
        maxStateByEvent.set(h.event_id, t)
      }
    }

    // Apply with no-downgrade guard (only advance if incoming rank is higher).
    const update = db.db.prepare(
      `UPDATE published_log
         SET pulse_state = ?
         WHERE relay_event_id = ?
           AND CASE pulse_state
                 WHEN 'dormant' THEN 0
                 WHEN 'discovered' THEN 1
                 WHEN 'verified' THEN 2
                 WHEN 'propagating' THEN 3
                 ELSE 0
               END < ?`
    )
    for (const [eventId, state] of maxStateByEvent) {
      update.run(state, eventId, PULSE_STATE_RANK[state])
    }
  } catch {
    // Silently fail: pulse events are best-effort.
  }
}
