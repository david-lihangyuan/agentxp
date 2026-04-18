import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDb, type Db } from '../db'
import { runSearchPulse } from '../service/search-pulse'

const OPERATOR = 'a'.repeat(64)

function seedReflection(
  db: Db,
  overrides: Partial<{
    title: string
    quality_score: number
    visibility: string
    created_at: number
  }> = {},
): number {
  const row = db.db
    .prepare(
      `INSERT INTO reflections (
         session_id, source_file, category, title, tried, expected, outcome, learned,
         why_wrong, tags, quality_score, published, relay_event_id, visibility, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'sess',
      null,
      'lesson',
      overrides.title ?? 'Docker DNS resolution failure',
      'tried',
      null,
      'succeeded',
      'learned',
      null,
      '[]',
      overrides.quality_score ?? 0.9,
      0,
      null,
      overrides.visibility ?? 'public',
      overrides.created_at ?? 0,
      0,
    )
  return Number(row.lastInsertRowid)
}

function mockSearch(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('runSearchPulse: proactive relay querying', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.db.close()
  })

  it('searches each eligible reflection exactly once and records hit counts', async () => {
    const id1 = seedReflection(db, { title: 'A' })
    const id2 = seedReflection(db, { title: 'B' })
    const fetchMock = mockSearch({ precision: [{}, {}], serendipity: [{}] })

    const r1 = await runSearchPulse(db, { relayUrl: 'http://r', operatorPubkey: OPERATOR })
    expect(r1.searched).toBe(2)
    expect(r1.hits).toBe(6)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // A second tick with no new reflections must not re-search.
    const r2 = await runSearchPulse(db, { relayUrl: 'http://r', operatorPubkey: OPERATOR })
    expect(r2.searched).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const logged = db.db
      .prepare('SELECT reflection_id, query, hit_count FROM search_log ORDER BY reflection_id')
      .all() as Array<{ reflection_id: number; query: string; hit_count: number }>
    expect(logged.map((r) => r.reflection_id)).toEqual([id1, id2])
    expect(logged.every((r) => r.hit_count === 3)).toBe(true)
  })

  it('skips low-quality, private, and empty-title reflections', async () => {
    seedReflection(db, { quality_score: 0.3 })
    seedReflection(db, { visibility: 'private' })
    seedReflection(db, { title: '   ' })
    mockSearch({ precision: [], serendipity: [] })

    const r = await runSearchPulse(db, { relayUrl: 'http://r', operatorPubkey: OPERATOR })

    expect(r.searched).toBe(0)
    expect(
      (db.db.prepare('SELECT COUNT(*) AS c FROM search_log').get() as { c: number }).c,
    ).toBe(0)
  })

  it('caps at 5 reflections per tick', async () => {
    for (let i = 0; i < 8; i++) seedReflection(db, { title: `t${i}` })
    const fetchMock = mockSearch({ precision: [], serendipity: [] })

    const r = await runSearchPulse(db, { relayUrl: 'http://r', operatorPubkey: OPERATOR })

    expect(r.searched).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('counts http errors and still records successful rows', async () => {
    seedReflection(db, { title: 'will-fail' })
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++
        if (call === 1) return { ok: false, json: async () => ({}) }
        return { ok: true, json: async () => ({ precision: [{}], serendipity: [] }) }
      }),
    )

    const r = await runSearchPulse(db, { relayUrl: 'http://r', operatorPubkey: OPERATOR })

    expect(r.searched).toBe(0)
    expect(r.errors).toBe(1)
  })

  it('sends q and operator_pubkey as query params', async () => {
    seedReflection(db, { title: 'hello world' })
    const fetchMock = mockSearch({ precision: [], serendipity: [] })

    await runSearchPulse(db, { relayUrl: 'http://r', operatorPubkey: OPERATOR })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/search')
    expect(url).toContain('q=hello%20world')
    expect(url).toContain(`operator_pubkey=${OPERATOR}`)
  })

  it('rejects a malformed operator pubkey', async () => {
    seedReflection(db)
    const fetchMock = mockSearch({ precision: [], serendipity: [] })

    const r = await runSearchPulse(db, { relayUrl: 'http://r', operatorPubkey: 'not-hex' })

    expect(r.searched).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
