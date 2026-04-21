// experiences view (SPEC 02-data-model §6.2).
import type { ExperiencePayload, SerendipEvent } from '@agentxp/protocol'
import type { Db } from './db.js'

export interface ExperienceSummary {
  event_id: string
  pubkey: string
  what: string
  tried: string
  outcome: string
  learned: string
  tags: string[]
  created_at: number
}

export function insertExperience(db: Db, event: SerendipEvent): void {
  const payload = event.payload as ExperiencePayload
  const data = payload.data
  db.prepare(
    `INSERT OR IGNORE INTO experiences
       (event_id, pubkey, what, tried, outcome, learned, scope_json, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    event.pubkey,
    data.what,
    data.tried,
    data.outcome,
    data.learned,
    data.scope ? JSON.stringify(data.scope) : null,
    JSON.stringify(event.tags),
    event.created_at,
  )

  for (const rel of ['supersedes', 'extends', 'qualifies'] as const) {
    const to = payload[rel]
    if (typeof to === 'string' && to.length > 0) {
      db.prepare(
        `INSERT OR IGNORE INTO experience_relations
           (from_experience_id, to_experience_id, relation_type, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(event.id, to, rel, event.created_at)
    }
  }
}

interface ExperienceRow {
  event_id: string
  pubkey: string
  what: string
  tried: string
  outcome: string
  learned: string
  tags_json: string
  created_at: number
}

function rowToSummary(row: ExperienceRow): ExperienceSummary {
  return {
    event_id: row.event_id,
    pubkey: row.pubkey,
    what: row.what,
    tried: row.tried,
    outcome: row.outcome,
    learned: row.learned,
    tags: JSON.parse(row.tags_json) as string[],
    created_at: row.created_at,
  }
}

export function listExperiences(
  db: Db,
  opts: { pubkey: string | undefined; limit: number },
): ExperienceSummary[] {
  const where = opts.pubkey ? 'WHERE pubkey = ?' : ''
  const sql = `SELECT event_id, pubkey, what, tried, outcome, learned, tags_json, created_at
               FROM experiences ${where}
               ORDER BY created_at DESC LIMIT ?`
  const params: Array<string | number> = opts.pubkey
    ? [opts.pubkey, opts.limit]
    : [opts.limit]
  return (db.prepare(sql).all(...params) as ExperienceRow[]).map(rowToSummary)
}
