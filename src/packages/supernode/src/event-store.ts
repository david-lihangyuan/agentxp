// Raw event log (SPEC 02-data-model §6.1).
import type { SerendipEvent } from '@serendip/protocol'
import type { Db } from './db.js'

/**
 * Insert an event into the `events` table. Returns true if the row
 * was newly inserted, false if a row with this id already existed
 * (idempotency per SPEC 03-modules-platform §2).
 */
export function insertEvent(db: Db, event: SerendipEvent, receivedAt: number): boolean {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO events
         (id, v, pubkey, operator_pubkey, created_at, kind, payload_json,
          tags_json, visibility, sig, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.id,
      event.v,
      event.pubkey,
      event.operator_pubkey,
      event.created_at,
      event.kind,
      JSON.stringify(event.payload),
      JSON.stringify(event.tags),
      event.visibility,
      event.sig,
      receivedAt,
    )
  return info.changes === 1
}

interface EventRow {
  id: string
  v: number
  pubkey: string
  operator_pubkey: string
  created_at: number
  kind: string
  payload_json: string
  tags_json: string
  visibility: string
  sig: string
}

function rowToEvent(row: EventRow): SerendipEvent {
  return {
    v: row.v as 1,
    id: row.id,
    pubkey: row.pubkey,
    operator_pubkey: row.operator_pubkey,
    created_at: row.created_at,
    kind: row.kind as SerendipEvent['kind'],
    payload: JSON.parse(row.payload_json) as SerendipEvent['payload'],
    tags: JSON.parse(row.tags_json) as string[],
    visibility: row.visibility as SerendipEvent['visibility'],
    sig: row.sig,
  }
}

export function getEvent(db: Db, id: string): SerendipEvent | null {
  const row = db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow | undefined
  return row ? rowToEvent(row) : null
}

export interface ListEventsQuery {
  kind: string | undefined
  pubkey: string | undefined
  since: number | undefined
  until: number | undefined
  limit: number
}

export function listEvents(db: Db, q: ListEventsQuery): SerendipEvent[] {
  const clauses: string[] = []
  const params: Array<string | number> = []
  if (q.kind) {
    clauses.push('kind = ?')
    params.push(q.kind)
  }
  if (q.pubkey) {
    clauses.push('pubkey = ?')
    params.push(q.pubkey)
  }
  if (q.since !== undefined) {
    clauses.push('created_at >= ?')
    params.push(q.since)
  }
  if (q.until !== undefined) {
    clauses.push('created_at <= ?')
    params.push(q.until)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const sql = `SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ?`
  params.push(q.limit)
  const rows = db.prepare(sql).all(...params) as EventRow[]
  return rows.map(rowToEvent)
}
