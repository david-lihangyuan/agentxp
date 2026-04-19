// Keyword search over experiences (SPEC 01-interfaces §5.1 GET /search).
// MVP: case-insensitive substring over what/tried/learned/tags. Embedding-
// backed semantic search is deferred (see docs/spec/04-deferred.md).
import type { Db } from './db.js'
import type { ExperienceSummary } from './experience-store.js'
import { logSearch, writePulse } from './pulse-store.js'
import { appendImpact } from './scoring.js'

export interface SearchResult {
  event_id: string
  score: number
  experience: ExperienceSummary
}

export interface SearchOptions {
  viewerPubkey?: string | null
  now?: number
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
 * free-text columns plus at least one tag. Side effects per SPEC
 * 03-modules-product §9: every search with ≥1 hit is recorded in
 * search_log; every hit generates a pulse_events row and an
 * impact_ledger contribution (bounded by same-operator + daily cap).
 */
export function search(
  db: Db,
  q: string,
  limit: number,
  opts: SearchOptions = {},
): SearchResult[] {
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

  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const viewer = opts.viewerPubkey ?? null
  logSearch(db, q, viewer, rows.length, now)

  for (const r of rows) {
    writePulse(db, {
      event_id: r.event_id,
      pubkey: viewer ?? r.pubkey,
      kind: 'search_hit',
      created_at: now,
    })
    appendImpact({
      db,
      experienceId: r.event_id,
      action: 'search_hit',
      sourcePubkey: viewer,
      now,
    })
  }

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
