import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../src/db.js'
import type { Db } from '../src/db.js'
import { DEFAULT_CONFIG } from '../src/types.js'
import type { PluginConfig } from '../src/types.js'
import { createCorpusSupplement } from '../src/memory-corpus.js'
import type { MemoryCorpusSupplement } from '../src/memory-corpus.js'

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<PluginConfig>): PluginConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

function seedLesson(
  db: Db,
  fields?: {
    what?: string
    tried?: string
    outcome?: string
    learned?: string
    source?: string
    tags?: string[]
  },
): number {
  return db.insertLesson({
    what: fields?.what ?? 'test problem',
    tried: fields?.tried ?? 'test approach',
    outcome: fields?.outcome ?? 'test outcome',
    learned: fields?.learned ?? 'test lesson learned',
    source: fields?.source ?? 'local',
    tags: fields?.tags ?? [],
  })
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('memory-corpus', () => {
  let db: Db
  let config: PluginConfig
  let corpus: MemoryCorpusSupplement

  beforeEach(() => {
    db = createDb(':memory:')
    config = makeConfig()
    corpus = createCorpusSupplement(db, config)
  })

  afterEach(() => {
    db.close()
  })

  // ── search ─────────────────────────────────────────────────────────────

  describe('search', () => {
    it('returns empty array for empty query', async () => {
      seedLesson(db, { what: 'debugging tips', tried: 'restart' })
      const results = await corpus.search({ query: '' })
      expect(results).toEqual([])
    })

    it('returns empty array when no lessons match', async () => {
      seedLesson(db, { what: 'cooking recipe', tried: 'bake cake', learned: 'use butter' })
      const results = await corpus.search({ query: 'quantum physics' })
      expect(results).toEqual([])
    })

    it('returns MemoryCorpusSearchResult[] with correct fields', async () => {
      const id = seedLesson(db, {
        what: 'deploy error handling',
        tried: 'added retry logic',
        outcome: 'deploys recovered',
        learned: 'always retry transient errors',
        source: 'local',
        tags: ['deploy', 'error'],
      })

      const results = await corpus.search({ query: 'deploy error' })
      expect(results.length).toBeGreaterThan(0)

      const r = results[0]
      expect(r.corpus).toBe('agentxp')
      expect(r.path).toBe(`agentxp://lesson/${id}`)
      expect(r.title).toBe('deploy error handling')
      expect(r.kind).toBe('experience')
      expect(r.snippet).toContain('added retry logic')
      expect(r.snippet).toContain('always retry transient errors')
      expect(r.id).toBe(String(id))
      expect(r.citation).toBe(`[AgentXP #${id}]`)
      expect(r.source).toBe('local')
      expect(r.provenanceLabel).toBe('AgentXP')
      expect(r.sourceType).toBe('plugin')
    })

    it('scores are monotonically decreasing', async () => {
      seedLesson(db, { what: 'error handling A', tried: 'approach A', learned: 'lesson A' })
      seedLesson(db, { what: 'error handling B', tried: 'approach B', learned: 'lesson B' })
      seedLesson(db, { what: 'error handling C', tried: 'approach C', learned: 'lesson C' })

      const results = await corpus.search({ query: 'error handling' })
      expect(results.length).toBeGreaterThanOrEqual(2)

      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
      }
    })

    it('respects maxResults limit', async () => {
      for (let i = 0; i < 10; i++) {
        seedLesson(db, { what: `error case ${i}`, tried: `fix ${i}`, learned: `lesson ${i}` })
      }

      const results = await corpus.search({ query: 'error', maxResults: 3 })
      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('defaults maxResults to 5', async () => {
      for (let i = 0; i < 10; i++) {
        seedLesson(db, { what: `error case ${i}`, tried: `fix ${i}`, learned: `lesson ${i}` })
      }

      const results = await corpus.search({ query: 'error' })
      expect(results.length).toBeLessThanOrEqual(5)
    })

    it('all results have corpus = agentxp', async () => {
      seedLesson(db, { what: 'test A', tried: 'try A', learned: 'learn A' })
      seedLesson(db, { what: 'test B', tried: 'try B', learned: 'learn B' })

      const results = await corpus.search({ query: 'test' })
      for (const r of results) {
        expect(r.corpus).toBe('agentxp')
      }
    })
  })

  // ── get ────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns lesson by numeric ID string', async () => {
      const id = seedLesson(db, {
        what: 'API design patterns',
        tried: 'REST vs GraphQL',
        outcome: 'REST simpler',
        learned: 'start with REST',
        source: 'local',
        tags: ['api', 'design'],
      })

      const result = await corpus.get({ lookup: String(id) })
      expect(result).not.toBeNull()
      expect(result!.corpus).toBe('agentxp')
      expect(result!.path).toBe(`agentxp://lesson/${id}`)
      expect(result!.title).toBe('API design patterns')
      expect(result!.kind).toBe('experience')
      expect(result!.content).toContain('API design patterns')
      expect(result!.content).toContain('REST vs GraphQL')
      expect(result!.content).toContain('REST simpler')
      expect(result!.content).toContain('start with REST')
      expect(result!.fromLine).toBe(1)
      expect(result!.lineCount).toBeGreaterThan(0)
      expect(result!.id).toBe(String(id))
      expect(result!.provenanceLabel).toBe('AgentXP')
      expect(result!.sourceType).toBe('plugin')
    })

    it('returns lesson by agentxp:// URI', async () => {
      const id = seedLesson(db, {
        what: 'URI based lookup',
        tried: 'parse URI',
        outcome: 'works',
        learned: 'use URI scheme',
      })

      const result = await corpus.get({ lookup: `agentxp://lesson/${id}` })
      expect(result).not.toBeNull()
      expect(result!.id).toBe(String(id))
      expect(result!.title).toBe('URI based lookup')
    })

    it('returns null for non-existent ID', async () => {
      const result = await corpus.get({ lookup: '99999' })
      expect(result).toBeNull()
    })

    it('returns null for invalid lookup string', async () => {
      const result = await corpus.get({ lookup: 'not-a-number' })
      expect(result).toBeNull()
    })

    it('returns null for empty lookup', async () => {
      const result = await corpus.get({ lookup: '' })
      expect(result).toBeNull()
    })

    it('content includes tags when present', async () => {
      const id = seedLesson(db, {
        what: 'tagged lesson',
        tried: 'something',
        outcome: 'good',
        learned: 'tags work',
        tags: ['alpha', 'beta'],
      })

      const result = await corpus.get({ lookup: String(id) })
      expect(result).not.toBeNull()
      expect(result!.content).toContain('Tags: alpha, beta')
    })

    it('content excludes tags line when no tags', async () => {
      const id = seedLesson(db, {
        what: 'untagged lesson',
        tried: 'something',
        outcome: 'ok',
        learned: 'no tags',
        tags: [],
      })

      const result = await corpus.get({ lookup: String(id) })
      expect(result).not.toBeNull()
      expect(result!.content).not.toContain('Tags:')
    })

    it('lineCount matches actual content lines', async () => {
      const id = seedLesson(db, {
        what: 'line count test',
        tried: 'check lines',
        outcome: 'correct',
        learned: 'count matches',
      })

      const result = await corpus.get({ lookup: String(id) })
      expect(result).not.toBeNull()
      const actualLines = result!.content.split('\n').length
      expect(result!.lineCount).toBe(actualLines)
    })
  })
})
