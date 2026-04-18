/**
 * verifier.ts — Emit `io.agentxp.verification` events for network
 * experiences that were injected into a session and subsequently had a
 * reflection outcome.
 *
 * Dedup: `verification_log.target_event_id` is a primary key, so each
 * network experience is verified at most once per plugin install. Outcome
 * aggregation per session:
 *   any reflection `succeeded`  → 'confirmed'
 *   all reflections `failed`    → 'refuted'
 *   mixed / only `partial`      → 'partial'
 */

import type { Db } from '../db.js'
import { toVerificationEvent, type VerificationOutcome } from '../protocol/serendip.js'

export interface VerifierConfig {
  relayUrl: string
  operatorPubkey: string
  /** Hex-encoded Ed25519 private key (64 chars). */
  agentKey: string
}

export interface VerifierResult {
  published: number
  skipped: number
  errors: number
}

const MAX_PER_TICK = 10

interface InjectionCandidate {
  session_id: string
  source_ids: string
  created_at: number
}

interface ReflectionOutcomeRow {
  outcome: string
}

interface NetworkExperienceRow {
  relay_event_id: string
}

function parseAgentKey(hex: string): Uint8Array | null {
  if (!hex || typeof hex !== 'string') return null
  const clean = hex.trim().replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) return null
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function parseSourceIds(json: string): number[] {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is number => Number.isInteger(x))
  } catch {
    return []
  }
}

/** Map a set of reflection outcomes to a verification outcome. */
export function aggregateOutcome(outcomes: string[]): VerificationOutcome | null {
  if (outcomes.length === 0) return null
  if (outcomes.some((o) => o === 'succeeded')) return 'confirmed'
  if (outcomes.every((o) => o === 'failed')) return 'refuted'
  return 'partial'
}

export async function publishVerifications(
  db: Db,
  config: VerifierConfig,
): Promise<VerifierResult> {
  const result: VerifierResult = { published: 0, skipped: 0, errors: 0 }

  const privKey = parseAgentKey(config.agentKey)
  if (!privKey) return result
  if (!config.operatorPubkey || !/^[0-9a-f]{64}$/.test(config.operatorPubkey)) return result
  if (!config.relayUrl) return result

  const httpUrl = config.relayUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')

  const injections = db.db
    .prepare(
      `SELECT session_id, source_ids, created_at
       FROM injection_log
       WHERE source_type = 'network' AND injected = 1
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all() as InjectionCandidate[]

  const getOutcomes = db.db.prepare(
    `SELECT outcome FROM reflections
     WHERE session_id = ? AND created_at >= ?`,
  )
  const getNetworkEventId = db.db.prepare(
    `SELECT relay_event_id FROM network_experiences WHERE id = ?`,
  )
  const alreadyVerified = db.db.prepare(
    `SELECT 1 FROM verification_log WHERE target_event_id = ?`,
  )
  const recordVerification = db.db.prepare(
    `INSERT OR IGNORE INTO verification_log
       (target_event_id, outcome, session_id, verified_at, relay_event_id)
     VALUES (?, ?, ?, ?, ?)`,
  )

  for (const inj of injections) {
    if (result.published >= MAX_PER_TICK) break

    const sourceIds = parseSourceIds(inj.source_ids)
    if (sourceIds.length === 0) continue

    const outcomes = (getOutcomes.all(inj.session_id, inj.created_at) as ReflectionOutcomeRow[])
      .map((r) => r.outcome)
    const outcome = aggregateOutcome(outcomes)
    if (!outcome) {
      result.skipped++
      continue
    }

    for (const localNetId of sourceIds) {
      if (result.published >= MAX_PER_TICK) break
      const row = getNetworkEventId.get(localNetId) as NetworkExperienceRow | undefined
      if (!row?.relay_event_id) continue
      if (alreadyVerified.get(row.relay_event_id)) continue

      let signedEvent
      try {
        signedEvent = await toVerificationEvent(
          { targetEventId: row.relay_event_id, outcome },
          privKey,
          config.operatorPubkey,
        )
      } catch {
        result.errors++
        continue
      }

      try {
        const resp = await fetch(`${httpUrl}/api/v1/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signedEvent),
        })
        if (!resp.ok) {
          result.errors++
          continue
        }
      } catch {
        result.errors++
        continue
      }

      recordVerification.run(row.relay_event_id, outcome, inj.session_id, Date.now(), signedEvent.id)
      result.published++
    }
  }

  return result
}
