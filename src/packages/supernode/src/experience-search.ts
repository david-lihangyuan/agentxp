// Keyword search over experiences (SPEC 01-interfaces §5.1 GET /search).
// MVP: case-insensitive substring over what/tried/learned/tags. Embedding-
// backed semantic search is deferred (see docs/spec/04-deferred.md).
import type { Db } from './db.js'
import type { ExperienceSummary } from './experience-store.js'

export interface SearchResult {
  event_id: string
  score: number
  experience: ExperienceSummary
}

interface Row {
  event_id: string
  pubkey: string
  what: string
  tried: string
  outcome: string
  learned: string
  tags_json: string
  created_at: number
  score: number
}

/**
 * Return top-N experiences matching `q`. Scoring is a simple count of
 * matches across text columns; 0.0 = no match, 1.0 = matched all three
 * free-text columns plus at least one tag.
 */
export function search(db: Db, q: string, limit: number): SearchResult[] {
  const term = `%${q.toLowerCase()}%`
  const rows = db
    .prepare(
      `SELECT event_id, pubkey, what, tried, outcome, learned, tags_json, created_at,
              ( (CASE WHEN LOWER(what)    LIKE ? THEN 1 ELSE 0 END)
              + (CASE WHEN LOWER(tried)   LIKE ? THEN 1 ELSE 0 END)
              + (CASE WHEN LOWER(learned) LIKE ? THEN 1 ELSE 0 END)
              + (CASE WHEN LOWER(tags_json) LIKE ? THEN 1 ELSE 0 END)
              ) AS score
         FROM experiences
        WHERE score > 0
        ORDER BY score DESC, created_at DESC
        LIMIT ?`,
    )
    .all(term, term, term, term, limit) as Row[]

  return rows.map((r) => ({
    event_id: r.event_id,
    score: r.score / 4,
    experience: {
      event_id: r.event_id,
      pubkey: r.pubkey,
      what: r.what,
      tried: r.tried,
      outcome: r.outcome,
      learned: r.learned,
      tags: JSON.parse(r.tags_json) as string[],
      created_at: r.created_at,
    },
  }))
}
