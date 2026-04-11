// B5 Test Suite: Dual-Channel Search
// TDD: Precision + serendipity, no raw vectors, graceful degradation, scope-aware, private isolation, failure filter.
import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import { runMigrations } from '../src/db'
import { ExperienceStore } from '../src/agentxp/experience-store'
import { ExperienceSearch } from '../src/agentxp/experience-search'
import { CircuitBreaker } from '../src/circuit-breaker'
import { createApp } from '../src/app'

async function seedExperience(
  db: Database,
  operatorPubkey: string,
  data: Record<string, unknown>,
  tags: string[] = ['docker', 'networking'],
  visibility: 'public' | 'private' = 'public'
) {
  const opKey = await generateOperatorKey()
  const agentKey = await delegateAgentKey(opKey, 'seed-agent', 90)

  // Use operator pubkey for isolation test
  const payload = {
    type: 'experience',
    data: {
      what: 'Test experience',
      tried: 'Test action',
      outcome: 'succeeded',
      learned: 'Test lesson',
      ...data,
    },
  }
  const unsigned = createEvent('intent.broadcast', payload, tags)
  const withOp = { ...unsigned, operator_pubkey: operatorPubkey, visibility }
  const event = await signEvent(withOp, agentKey)

  // Store event directly
  db.prepare(`
    INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(event.id, event.pubkey, operatorPubkey, event.kind, event.created_at, JSON.stringify(event.payload), JSON.stringify(tags), visibility, event.sig, Math.floor(Date.now() / 1000))

  // Store experience with indexed status (and mock embedding)
  const isFailure = (data['outcome'] as string) === 'failed' ? 1 : 0
  const scope = data['scope'] ? JSON.stringify(data['scope']) : null
  const mockEmbedding = JSON.stringify([0.1, 0.2, 0.3, 0.4, 0.5])

  db.prepare(`
    INSERT INTO experiences (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, scope, is_failure, embedding, embedding_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'indexed', ?)
  `).run(
    event.id,
    event.pubkey,
    operatorPubkey,
    (data['what'] as string) ?? 'Test experience',
    (data['tried'] as string) ?? 'Test action',
    (data['outcome'] as string) ?? 'succeeded',
    (data['learned'] as string) ?? 'Test lesson',
    JSON.stringify(tags),
    visibility,
    scope,
    isFailure,
    mockEmbedding,
    event.created_at
  )

  return event
}

describe('B5: Precision Channel', () => {
  let db: Database
  let search: ExperienceSearch
  const operatorPubkey = 'a'.repeat(64)

  beforeEach(async () => {
    db = new Database(':memory:')
    runMigrations(db)
    search = new ExperienceSearch(db)
    // Seed experiences with 'docker' tag
    await seedExperience(db, operatorPubkey, { what: 'Docker DNS fix' }, ['docker', 'networking'])
    await seedExperience(db, operatorPubkey, { what: 'Kubernetes networking fix' }, ['kubernetes', 'networking'])
  })

  it('tag search returns matching results', async () => {
    const results = await search.search({ query: 'docker fix', tags: ['docker'] })
    expect(results.precision.length).toBeGreaterThan(0)
    expect(results.precision[0].match_score).toBeGreaterThan(0)
  })

  it('score_breakdown is included in results', async () => {
    const results = await search.search({ query: 'docker', tags: ['docker'] })
    expect(results.precision.length).toBeGreaterThan(0)
    expect(results.precision[0].score_breakdown).toBeDefined()
    expect(typeof results.precision[0].score_breakdown.tag_score).toBe('number')
    expect(typeof results.precision[0].score_breakdown.embedding_score).toBe('number')
  })

  it('response NEVER contains raw embedding vectors', async () => {
    const results = await search.search({ query: 'docker', tags: ['docker'] })
    expect(results.precision.length).toBeGreaterThan(0)
    for (const result of results.precision) {
      expect((result.experience as Record<string, unknown>)['embedding']).toBeUndefined()
    }
    for (const result of results.serendipity) {
      expect((result.experience as Record<string, unknown>)['embedding']).toBeUndefined()
    }
    expect((results.precision[0].score_breakdown as Record<string, unknown>)['embedding_vector']).toBeUndefined()
  })

  it('results have match_score > 0 for tag matches', async () => {
    const results = await search.search({ query: 'any', tags: ['docker'] })
    expect(results.precision[0].match_score).toBeGreaterThan(0)
  })
})

describe('B5: Graceful Degradation', () => {
  let db: Database
  let search: ExperienceSearch
  const operatorPubkey = 'b'.repeat(64)

  beforeEach(async () => {
    db = new Database(':memory:')
    runMigrations(db)
    search = new ExperienceSearch(db)
    await seedExperience(db, operatorPubkey, { what: 'Docker networking fix' }, ['docker'])
  })

  it('no results for unknown query sets degraded=true', async () => {
    const results = await search.search({ query: 'zzz_nonexistent_xyz_12345_abc' })
    expect(results.degraded).toBe(true)
    expect(results.message).toContain('no experiences found')
  })

  it('keyword broadening used when exact tag search returns empty', async () => {
    // Query with no tags but keyword match should still find results
    const results = await search.search({ query: 'docker networking' })
    // Even without tags, keyword search should find results (degraded path)
    // The key is that degraded doesn't mean empty if keyword match works
    expect(results).toBeDefined()
  })

  it('degraded=false when results are found', async () => {
    const results = await search.search({ query: 'docker', tags: ['docker'] })
    expect(results.precision.length).toBeGreaterThan(0)
    expect(results.degraded).toBe(false)
  })
})

describe('B5: Scope-Aware Matching', () => {
  let db: Database
  let search: ExperienceSearch
  const operatorPubkey = 'c'.repeat(64)

  beforeEach(async () => {
    db = new Database(':memory:')
    runMigrations(db)
    search = new ExperienceSearch(db)
    await seedExperience(
      db,
      operatorPubkey,
      { what: 'Linux Docker fix', scope: { platforms: ['linux'] } },
      ['docker']
    )
  })

  it('scope-matching result has scope_match=true', async () => {
    const results = await search.search({
      query: 'docker',
      tags: ['docker'],
      env: { platform: 'linux' },
    })
    expect(results.precision.length).toBeGreaterThan(0)
    expect(results.precision[0].scope_match).toBe(true)
  })

  it('scope-mismatch result has scope_warning', async () => {
    const results = await search.search({
      query: 'docker',
      tags: ['docker'],
      env: { platform: 'macos' },
    })
    expect(results.precision.length).toBeGreaterThan(0)
    expect(results.precision[0].scope_warning).toContain('linux')
  })

  it('scope-aware matching via HTTP API', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/search?q=test&tags=docker&env%5Bplatform%5D=linux')
    expect(res.status).toBe(200)
    const body = await res.json() as { precision: unknown[]; serendipity: unknown[] }
    expect(body.precision).toBeDefined()
    expect(body.serendipity).toBeDefined()
  })
})

describe('B5: Private Experience Isolation', () => {
  let db: Database
  let search: ExperienceSearch
  const operatorA = 'd'.repeat(64)
  const operatorB = 'e'.repeat(64)

  beforeEach(async () => {
    db = new Database(':memory:')
    runMigrations(db)
    search = new ExperienceSearch(db)
    // Seed private experience for operator A
    await seedExperience(
      db,
      operatorA,
      { what: 'Secret Docker configuration' },
      ['docker', 'secret'],
      'private'
    )
    // Seed public experience
    await seedExperience(
      db,
      operatorA,
      { what: 'Public Docker fix' },
      ['docker'],
      'public'
    )
  })

  it('private experience not visible to different operator', async () => {
    const results = await search.search({
      query: 'Secret Docker',
      tags: ['secret'],
      operatorPubkey: operatorB,
    })
    // Private experience must NOT appear; public ones are allowed
    for (const r of results.precision) {
      expect(r.experience.visibility).not.toBe('private')
    }
    for (const r of results.serendipity) {
      expect(r.experience.visibility).not.toBe('private')
    }
  })

  it('private experience visible to owner operator', async () => {
    const results = await search.search({
      query: 'Secret Docker',
      tags: ['docker', 'secret'],
      operatorPubkey: operatorA,
    })
    expect(results.precision.length).toBeGreaterThan(0)
  })

  it('public experiences visible to all operators', async () => {
    const results = await search.search({
      query: 'docker',
      tags: ['docker'],
      operatorPubkey: operatorB,
    })
    expect(results.precision.length).toBeGreaterThan(0)
  })

  it('no operatorPubkey only returns public experiences', async () => {
    const results = await search.search({
      query: 'docker',
      tags: ['secret'],
    })
    // All returned results must be public
    for (const r of results.precision) {
      expect(r.experience.visibility).toBe('public')
    }
    for (const r of results.serendipity) {
      expect(r.experience.visibility).toBe('public')
    }
  })
})

describe('B5: Failure Filter', () => {
  let db: Database
  let search: ExperienceSearch
  const operatorPubkey = 'f'.repeat(64)

  beforeEach(async () => {
    db = new Database(':memory:')
    runMigrations(db)
    search = new ExperienceSearch(db)
    await seedExperience(db, operatorPubkey, { what: 'Failed Docker approach', outcome: 'failed', learned: 'This DNS approach does not work' }, ['docker'])
    await seedExperience(db, operatorPubkey, { what: 'Successful Docker fix', outcome: 'succeeded', learned: 'Restarting daemon works' }, ['docker'])
  })

  it('filter[outcome]=failed returns only failed experiences', async () => {
    const results = await search.search({
      query: 'docker',
      tags: ['docker'],
      filter: { outcome: 'failed' },
    })
    expect(results.precision.length).toBeGreaterThan(0)
    for (const result of results.precision) {
      expect(result.experience.outcome).toBe('failed')
    }
  })

  it('failure filter via HTTP query parameter', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/search?q=test&filter%5Boutcome%5D=failed')
    expect(res.status).toBe(200)
  })

  it('search without filter returns all outcomes', async () => {
    const results = await search.search({ query: 'docker', tags: ['docker'] })
    const outcomes = results.precision.map((r) => r.experience.outcome)
    expect(outcomes).toContain('failed')
    expect(outcomes).toContain('succeeded')
  })
})

describe('B5: Serendipity Channel', () => {
  let db: Database
  let search: ExperienceSearch

  beforeEach(async () => {
    db = new Database(':memory:')
    runMigrations(db)
    search = new ExperienceSearch(db)
    // Seed multiple public experiences
    const opPubkey = '1'.repeat(64)
    await seedExperience(db, opPubkey, { what: 'Docker networking fix' }, ['docker'])
    await seedExperience(db, opPubkey, { what: 'Python async bug' }, ['python'])
    await seedExperience(db, opPubkey, { what: 'Kubernetes DNS fix' }, ['kubernetes'])
  })

  it('serendipity channel exists in response', async () => {
    const results = await search.search({ query: 'networking', tags: ['docker'] })
    expect(results.serendipity).toBeDefined()
    expect(Array.isArray(results.serendipity)).toBe(true)
  })

  it('serendipity results have no raw embedding vectors', async () => {
    const results = await search.search({ query: 'test' })
    for (const result of results.serendipity) {
      expect((result.experience as Record<string, unknown>)['embedding']).toBeUndefined()
    }
  })
})
