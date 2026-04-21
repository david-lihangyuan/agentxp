// Local draft staging (02-data-model §7.1). Drafts survive restart and
// carry retry metadata; they are removed only after the relay returns
// 200 (handled by publisher).
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import type { ExperienceData } from '@agentxp/protocol'

export type ReflectionTier = 'in-session' | 'end-of-session'

export interface DraftRow {
  id: number
  tier: ReflectionTier
  data: ExperienceData
  tags: string[]
  created_at: number
  retry_count: number
  last_attempt: number | null
  next_attempt_at: number
}

export interface DraftStore {
  add(tier: ReflectionTier, data: ExperienceData, tags: string[], createdAt: number): DraftRow
  listDue(now: number): DraftRow[]
  listAll(): DraftRow[]
  markAttempt(id: number, now: number, nextAt: number): void
  remove(id: number): void
  close(): void
}

function parseRow(row: {
  id: number
  tier: string
  data_json: string
  tags_json: string
  created_at: number
  retry_count: number
  last_attempt: number | null
  next_attempt_at: number
}): DraftRow {
  return {
    id: row.id,
    tier: row.tier as ReflectionTier,
    data: JSON.parse(row.data_json) as ExperienceData,
    tags: JSON.parse(row.tags_json) as string[],
    created_at: row.created_at,
    retry_count: row.retry_count,
    last_attempt: row.last_attempt,
    next_attempt_at: row.next_attempt_at,
  }
}

export function openDraftStore(dbPath: string): DraftStore {
  const db: Db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tier TEXT NOT NULL CHECK(tier IN ('in-session','end-of-session')),
      data_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_attempt INTEGER,
      next_attempt_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_due ON drafts(next_attempt_at);
  `)

  const insert = db.prepare(
    `INSERT INTO drafts (tier, data_json, tags_json, created_at, next_attempt_at)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
  )
  const selectDue = db.prepare(
    `SELECT * FROM drafts WHERE next_attempt_at <= ? ORDER BY created_at ASC`,
  )
  const selectAll = db.prepare(`SELECT * FROM drafts ORDER BY created_at ASC`)
  const updateAttempt = db.prepare(
    `UPDATE drafts SET retry_count = retry_count + 1,
       last_attempt = ?, next_attempt_at = ? WHERE id = ?`,
  )
  const del = db.prepare(`DELETE FROM drafts WHERE id = ?`)

  return {
    add(tier, data, tags, createdAt) {
      const row = insert.get(
        tier,
        JSON.stringify(data),
        JSON.stringify(tags),
        createdAt,
        createdAt,
      ) as Parameters<typeof parseRow>[0]
      return parseRow(row)
    },
    listDue(now) {
      return (selectDue.all(now) as Parameters<typeof parseRow>[0][]).map(parseRow)
    },
    listAll() {
      return (selectAll.all() as Parameters<typeof parseRow>[0][]).map(parseRow)
    },
    markAttempt(id, now, nextAt) {
      updateAttempt.run(now, nextAt, id)
    },
    remove(id) {
      del.run(id)
    },
    close() {
      db.close()
    },
  }
}
