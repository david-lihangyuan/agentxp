/**
 * network-puller.ts — Pull experiences from relay into local network_experiences table.
 *
 * Flow:
 * 1. Fetch event list from relay (GET /api/v1/events?limit=N) — no payload in list
 * 2. Filter: skip own pubkey, non-broadcast, already-imported
 * 3. Fetch full event detail for each candidate (GET /api/v1/events/:id)
 * 4. Parse payload.data into reflection fields
 * 5. Insert into network_experiences with initial trust_score
 *
 * Called by service tick (every 5 minutes). Designed to be idempotent.
 *
 * 2026-04-17: Created during end-to-end testing. Previously, the plugin
 * could publish to relay but never pulled back — network_experiences was
 * always empty, breaking the cross-agent learning loop.
 *
 * 2026-04-17 fix: List API does not return payload field. Must fetch each
 * event individually to get payload content.
 */

import type { Db } from '../db.js'

export interface PullConfig {
  relayUrl: string
  operatorPubkey: string
}

export interface PullResult {
  fetched: number
  imported: number
  skippedOwn: number
  skippedDup: number
  skippedInvalid: number
  errors: number
}

interface EventSummary {
  id: string
  pubkey: string
  kind: string
  created_at: number
  tags: string
  visibility: string
}

interface RelayEventFull {
  id: string
  pubkey: string
  kind: string
  created_at: number
  payload: string
  tags: string
  visibility: string
}

interface ExperiencePayload {
  type: string
  data: {
    what?: string
    tried?: string
    outcome?: string
    learned?: string
    scope?: string[]
  }
}

export async function pullNetworkExperiences(
  db: Db,
  config: PullConfig,
): Promise<PullResult> {
  const result: PullResult = {
    fetched: 0,
    imported: 0,
    skippedOwn: 0,
    skippedDup: 0,
    skippedInvalid: 0,
    errors: 0,
  }

  if (!config.relayUrl) return result

  // Normalize relay URL: wss:// → https://, ws:// → http://
  const httpUrl = config.relayUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')

  // 1. Fetch event list (no payload in list response)
  let summaries: EventSummary[]
  try {
    const resp = await fetch(`${httpUrl}/api/v1/events?limit=50`)
    if (!resp.ok) { result.errors++; return result }
    const body = await resp.json() as { events?: EventSummary[] }
    summaries = body.events ?? []
    result.fetched = summaries.length
  } catch {
    result.errors++
    return result
  }

  if (summaries.length === 0) return result

  // 2. Filter + dedup before fetching full events
  const candidates: EventSummary[] = []
  for (const s of summaries) {
    if (s.pubkey === config.operatorPubkey) { result.skippedOwn++; continue }
    if (s.kind !== 'intent.broadcast') continue
    const existing = db.db
      .prepare('SELECT id FROM network_experiences WHERE relay_event_id = ?')
      .get(s.id) as { id: number } | undefined
    if (existing) { result.skippedDup++; continue }
    candidates.push(s)
  }

  // 3. Fetch full event + parse + import
  for (const summary of candidates) {
    let event: RelayEventFull
    try {
      const resp = await fetch(`${httpUrl}/api/v1/events/${summary.id}`)
      if (!resp.ok) { result.errors++; continue }
      event = await resp.json() as RelayEventFull
    } catch {
      result.errors++
      continue
    }

    // Parse payload
    let payload: ExperiencePayload
    try {
      payload = JSON.parse(event.payload) as ExperiencePayload
    } catch {
      result.skippedInvalid++
      continue
    }

    if (payload.type !== 'experience' || !payload.data) {
      result.skippedInvalid++
      continue
    }

    const data = payload.data
    if (!data.what || !data.tried || !data.learned) {
      result.skippedInvalid++
      continue
    }

    // Classify
    let category: string = 'lesson'
    if ((data.outcome ?? '').toLowerCase().includes('fail')) category = 'mistake'

    // Tags
    let tags: string[] = []
    try {
      const parsed = JSON.parse(event.tags)
      if (Array.isArray(parsed)) tags = parsed
    } catch { /* keep empty */ }

    const scope = data.scope ?? tags
    const now = Date.now()

    try {
      (db.insertNetworkExperience as any).run(
        event.id,
        event.pubkey,
        category,
        data.what.slice(0, 200),
        data.tried,
        data.outcome ?? 'unknown',
        data.learned,
        JSON.stringify(tags),
        JSON.stringify(scope),
        0.5,
        'discovered',
        null,
        event.created_at * 1000,
        now,
      )
      result.imported++
    } catch {
      result.errors++
    }
  }

  return result
}
