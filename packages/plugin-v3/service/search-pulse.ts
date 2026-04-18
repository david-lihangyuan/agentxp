/**
 * search-pulse.ts — Proactively query the relay on behalf of recent
 * reflections so other operators' matching experiences transition through
 * the pulse state machine.
 *
 * The relay's `/api/v1/search` endpoint routes every result through
 * `PulseStateMachine.handleSearchHit` for the requester's
 * `operator_pubkey`, so the mere act of searching is the signal. This
 * module does not care about the result payload; it only ensures each
 * recent reflection produces one search call and records the outcome in
 * `search_log` for dedup.
 */

import type { Db } from '../db.js'

export interface SearchPulseConfig {
  relayUrl: string
  operatorPubkey: string
}

export interface SearchPulseResult {
  searched: number
  hits: number
  errors: number
}

const MAX_PER_TICK = 5
const MIN_QUALITY = 0.5

interface ReflectionRow {
  id: number
  title: string
  tags: string
}

interface SearchResponse {
  precision?: unknown[]
  serendipity?: unknown[]
}

/**
 * Run one tick of search-pulse. Picks up to MAX_PER_TICK reflections that
 * have never been searched and issues one GET /api/v1/search per
 * reflection. Each outcome is recorded in `search_log` (reflection_id is
 * the primary key so a reflection is searched at most once).
 */
export async function runSearchPulse(
  db: Db,
  config: SearchPulseConfig,
): Promise<SearchPulseResult> {
  const result: SearchPulseResult = { searched: 0, hits: 0, errors: 0 }

  if (!config.relayUrl || !config.operatorPubkey) return result
  if (!/^[0-9a-f]{64}$/.test(config.operatorPubkey)) return result

  const httpUrl = config.relayUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')

  const rows = db.db
    .prepare(
      `SELECT r.id, r.title, r.tags
       FROM reflections r
       WHERE r.quality_score > ?
         AND r.visibility != 'private'
         AND r.id NOT IN (SELECT reflection_id FROM search_log)
         AND COALESCE(TRIM(r.title), '') != ''
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
    .all(MIN_QUALITY, MAX_PER_TICK) as ReflectionRow[]

  if (rows.length === 0) return result

  const insert = db.db.prepare(
    `INSERT OR IGNORE INTO search_log (reflection_id, query, hit_count, searched_at)
     VALUES (?, ?, ?, ?)`,
  )

  for (const row of rows) {
    const query = row.title.trim().slice(0, 200)
    if (!query) continue

    const url =
      `${httpUrl}/api/v1/search` +
      `?q=${encodeURIComponent(query)}` +
      `&operator_pubkey=${encodeURIComponent(config.operatorPubkey)}`

    let hits = 0
    try {
      const resp = await fetch(url)
      if (!resp.ok) {
        console.warn(
          `[agentxp-v3][search-pulse] relay responded ${resp.status} reflection=${row.id}`
        )
        result.errors++
        continue
      }
      const body = (await resp.json()) as SearchResponse
      const precision = Array.isArray(body.precision) ? body.precision.length : 0
      const serendipity = Array.isArray(body.serendipity) ? body.serendipity.length : 0
      hits = precision + serendipity
    } catch (err) {
      console.warn(
        `[agentxp-v3][search-pulse] fetch failed reflection=${row.id} err=${(err as Error)?.message ?? err}`
      )
      result.errors++
      continue
    }

    insert.run(row.id, query, hits, Date.now())
    result.searched++
    result.hits += hits
  }

  return result
}
