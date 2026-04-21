// Corpus supplement contract (M7 Batch 2 · MILESTONES checks).
// The corpus reads from the existing staged_experiences table and
// returns OpenClaw MemoryCorpusSearchResult / MemoryCorpusGetResult
// shapes. No schema change to the DB is required for Batch 2; the
// visibility field is read from data_json if present and defaulted
// to 'unlisted' otherwise.
import { describe, it, expect } from 'vitest'
import { openPluginDb, type PluginDb } from '../src/db.js'
import { createCorpusSupplement } from '../src/memory-corpus.js'

function stage(
  db: PluginDb,
  opts: {
    sessionId: string
    what: string
    tried?: string
    learned?: string
    outcome?: string
    tags?: string[]
    visibility?: 'public' | 'unlisted' | 'private'
  },
): void {
  const data: Record<string, unknown> = {
    what: opts.what,
    tried: opts.tried ?? 'tried something',
    outcome: opts.outcome ?? 'succeeded',
    learned: opts.learned ?? 'learned something',
  }
  if (opts.visibility) data.visibility = opts.visibility
  const now = Math.floor(Date.now() / 1000)
  db.stageExperience({
    session_id: opts.sessionId,
    reason: 'exit',
    data_json: JSON.stringify(data),
    trace_json: JSON.stringify({ steps: [] }),
    tags_json: JSON.stringify(opts.tags ?? []),
    created_at: now,
    next_attempt_at: now,
  })
}

describe('memory-corpus · createCorpusSupplement', () => {
  it('returns empty results on an empty database (no default noise)', async () => {
    const db = openPluginDb(':memory:')
    try {
      const corpus = createCorpusSupplement(db)
      const results = await corpus.search({ query: 'anything' })
      expect(results).toEqual([])
    } finally {
      db.close()
    }
  })

  it('returns at least one result when query keywords intersect a tag', async () => {
    const db = openPluginDb(':memory:')
    try {
      stage(db, {
        sessionId: 's1',
        what: 'debug flaky test',
        tags: ['vitest', 'flaky', 'retry-logic'],
      })
      const corpus = createCorpusSupplement(db)
      const results = await corpus.search({ query: 'flaky vitest test run' })
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0]!.corpus).toBe('agentxp')
      expect(results[0]!.path).toMatch(/^agentxp:\/\/staged\/\d+$/)
      expect(results[0]!.sourceType).toBe('staged-experience')
      expect(results[0]!.kind).toBe('reasoning_trace')
      expect(results[0]!.provenanceLabel).toBe('AgentXP')
    } finally {
      db.close()
    }
  })

  it('matches keywords against data title/tried/learned in addition to tags', async () => {
    const db = openPluginDb(':memory:')
    try {
      stage(db, {
        sessionId: 's2',
        what: 'fix webpack bundling regression',
        tried: 'rolled back to last known-good config',
        tags: [],
      })
      const corpus = createCorpusSupplement(db)
      const results = await corpus.search({ query: 'webpack' })
      expect(results.length).toBe(1)
    } finally {
      db.close()
    }
  })

  it('excludes private and unlisted entries when scope is public-only', async () => {
    const db = openPluginDb(':memory:')
    try {
      stage(db, { sessionId: 'A', what: 'public win', tags: ['shared'], visibility: 'public' })
      stage(db, { sessionId: 'B', what: 'unlisted work', tags: ['shared'], visibility: 'unlisted' })
      stage(db, { sessionId: 'C', what: 'private secret', tags: ['shared'], visibility: 'private' })

      const publicOnly = createCorpusSupplement(db, { scope: 'public-only' })
      const publicRes = await publicOnly.search({ query: 'shared' })
      expect(publicRes.length).toBe(1)
      expect(publicRes[0]!.title).toContain('public win')

      const allScope = createCorpusSupplement(db, { scope: 'all' })
      const allRes = await allScope.search({ query: 'shared' })
      expect(allRes.length).toBe(3)
    } finally {
      db.close()
    }
  })

  it('caps results at maxResults and ranks more recent rows higher', async () => {
    const db = openPluginDb(':memory:')
    try {
      for (let i = 0; i < 12; i++) {
        stage(db, { sessionId: `s${i}`, what: `story ${i}`, tags: ['alpha'] })
      }
      const corpus = createCorpusSupplement(db)
      const results = await corpus.search({ query: 'alpha', maxResults: 5 })
      expect(results.length).toBe(5)
      // Newer IDs (higher created_at) should appear before older ones.
      const ids = results.map((r) => Number(r.id))
      const sorted = [...ids].sort((a, b) => b - a)
      expect(ids).toEqual(sorted)
    } finally {
      db.close()
    }
  })

  it('get() returns markdown content for a valid agentxp://staged/<id> lookup', async () => {
    const db = openPluginDb(':memory:')
    try {
      stage(db, {
        sessionId: 'sG',
        what: 'the thing',
        tried: 'the approach',
        learned: 'the lesson',
        tags: ['a', 'b'],
      })
      const row = db.listAllExperiences()[0]!
      const corpus = createCorpusSupplement(db)
      const got = await corpus.get({ lookup: `agentxp://staged/${row.id}` })
      expect(got).not.toBeNull()
      expect(got!.content).toContain('the thing')
      expect(got!.content).toContain('the approach')
      expect(got!.content).toContain('the lesson')
      expect(got!.kind).toBe('reasoning_trace')
      expect(got!.fromLine).toBe(1)
      expect(got!.lineCount).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('get() returns null for an unknown or malformed lookup', async () => {
    const db = openPluginDb(':memory:')
    try {
      const corpus = createCorpusSupplement(db)
      expect(await corpus.get({ lookup: 'agentxp://staged/9999' })).toBeNull()
      expect(await corpus.get({ lookup: 'random-garbage' })).toBeNull()
      expect(await corpus.get({ lookup: 'agentxp://reflection/1' })).toBeNull()
    } finally {
      db.close()
    }
  })
})
