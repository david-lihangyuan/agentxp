// pulse_events + search_log (SPEC 02-data-model §6.4; 03-modules-product §8, §9).
import type { Db } from './db.js'
import { createHash } from 'node:crypto'

export type PulseKind = 'search_hit' | 'verified' | 'outcome' | 'subscription_match'

export interface PulseRow {
  event_id: string
  pubkey: string
  kind: PulseKind
  outcome: string | null
  created_at: number
}

export function writePulse(
  db: Db,
  row: { event_id: string; pubkey: string; kind: PulseKind; outcome?: string | null; created_at: number },
): void {
  db.prepare(
    `INSERT INTO pulse_events (event_id, pubkey, kind, outcome, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.event_id, row.pubkey, row.kind, row.outcome ?? null, row.created_at)
}

export function listPulse(db: Db, limit: number): PulseRow[] {
  return db
    .prepare(
      `SELECT event_id, pubkey, kind, outcome, created_at
         FROM pulse_events ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(limit) as PulseRow[]
}

export function hashQuery(q: string): string {
  return createHash('sha256').update(q.toLowerCase().trim()).digest('hex').slice(0, 32)
}

export function logSearch(
  db: Db,
  q: string,
  viewerPubkey: string | null,
  hitCount: number,
  now: number,
): void {
  const day = Math.floor(now / 86_400)
  db.prepare(
    `INSERT INTO search_log (q_hash, pubkey, hit_count, created_at, day_bucket)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(hashQuery(q), viewerPubkey, hitCount, now, day)
}
