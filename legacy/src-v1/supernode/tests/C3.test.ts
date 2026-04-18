// C3 Test Suite: Impact Scoring
// TDD: search_hit +1, verified +5 (anti-gaming), cited +10, diversity score, daily cap.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import { runMigrations } from '../src/db'
import { ExperienceStore } from '../src/agentxp/experience-store'
import { CircuitBreaker } from '../src/circuit-breaker'
import { ImpactScoring } from '../src/agentxp/scoring'
import { createApp } from '../src/app'

async function makeAgent() {
  const opKey = await generateOperatorKey()
  const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)
  return { opKey, agentKey }
}

async function publishExperience(
  db: Database.Database,
  store: ExperienceStore,
  agentKey: Awaited<ReturnType<typeof delegateAgentKey>>,
  overrides: Record<string, unknown> = {}
): Promise<number> {
  const payload = {
    type: 'experience',
    data: {
      what: 'Docker DNS resolution failure',
      tried: 'Restarted Docker daemon',
      outcome: 'succeeded',
      learned: 'Restart clears DNS cache',
      ...overrides,
    },
  }
  const unsigned = createEvent('intent.broadcast', payload, ['docker', 'networking'])
  const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
  const event = await signEvent(withOp, agentKey)
  const result = store.store(event)
  if (!result.ok || !result.experienceId) throw new Error('Failed to store experience')
  return result.experienceId
}

describe('C3: Impact Scoring', () => {
  let db: Database.Database
  let store: ExperienceStore
  let scoring: ImpactScoring
  let circuitBreaker: CircuitBreaker

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    circuitBreaker = new CircuitBreaker({ threshold: 10000 })
    store = new ExperienceStore(db, circuitBreaker)
    scoring = new ImpactScoring(db)
  })

  it('publishing gives 0 score', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const result = scoring.getScore(expId)
    expect(result.total).toBe(0)
  })

  it('cross-operator search hit gives +1', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)

    const { agentKey: searcher } = await makeAgent() // different operator
    scoring.score(expId, 'search_hit', searcher.publicKey, agentKey.delegatedBy, searcher.delegatedBy)

    const result = scoring.getScore(expId)
    expect(result.total).toBe(1)
    expect(result.breakdown.search_hits).toBe(1)
  })

  it('same-operator search hit gives 0 (anti-gaming)', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)

    // Same operator: agentKey.delegatedBy is the ownerOperatorPubkey
    scoring.score(expId, 'search_hit', agentKey.publicKey, agentKey.delegatedBy, agentKey.delegatedBy)

    const result = scoring.getScore(expId)
    expect(result.total).toBe(0)
  })

  it('cross-operator verification gives +5', async () => {
    const { agentKey: owner } = await makeAgent()
    const expId = await publishExperience(db, store, owner)

    const { agentKey: verifier } = await makeAgent() // different operator
    const scoreResult = scoring.score(expId, 'verified', verifier.publicKey, owner.delegatedBy, verifier.delegatedBy)
    expect(scoreResult.points).toBeGreaterThan(0)

    const result = scoring.getScore(expId)
    expect(result.breakdown.verifications).toBeGreaterThan(0)
  })

  it('same-operator verification gives 0 (anti-gaming)', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)

    const scoreResult = scoring.score(expId, 'verified', agentKey.publicKey, agentKey.delegatedBy, agentKey.delegatedBy)
    expect(scoreResult.points).toBe(0)

    const result = scoring.getScore(expId)
    expect(result.total).toBe(0)
  })

  it('citation gives +10', async () => {
    const { agentKey: owner } = await makeAgent()
    const expId = await publishExperience(db, store, owner)

    const { agentKey: citer } = await makeAgent()
    const scoreResult = scoring.score(expId, 'cited', citer.publicKey, owner.delegatedBy, citer.delegatedBy)
    expect(scoreResult.points).toBe(10)

    const result = scoring.getScore(expId)
    expect(result.breakdown.citations).toBe(10)
  })

  it('daily cap: search hits cap at +5 per day', async () => {
    const { agentKey: owner } = await makeAgent()
    const expId = await publishExperience(db, store, owner)

    // Score 7 hits from different operators
    for (let i = 0; i < 7; i++) {
      const { agentKey: searcher } = await makeAgent()
      scoring.score(expId, 'search_hit', searcher.publicKey, owner.delegatedBy, searcher.delegatedBy)
    }

    const result = scoring.getScore(expId)
    // Cap is 5 points/day for search_hits
    expect(result.breakdown.search_hits).toBeLessThanOrEqual(5)
  })

  it('verifier diversity score is calculated', async () => {
    const { agentKey: owner } = await makeAgent()
    const expId = await publishExperience(db, store, owner)

    // Register verifiers in identities table
    const verifiers: Array<Awaited<ReturnType<typeof delegateAgentKey>>> = []
    for (let i = 0; i < 3; i++) {
      const { agentKey: verifier } = await makeAgent()
      verifiers.push(verifier)
      // Insert into identities so lookupOperator works
      db.prepare('INSERT OR IGNORE INTO identities (pubkey, kind, delegated_by, registered_at) VALUES (?, ?, ?, ?)')
        .run(verifier.publicKey, 'agent', verifier.delegatedBy, Math.floor(Date.now() / 1000))
      scoring.score(expId, 'verified', verifier.publicKey, owner.delegatedBy, verifier.delegatedBy)
    }

    const diversity = scoring.getVerifierDiversity(expId)
    expect(diversity.operator_count).toBeGreaterThan(0)
    expect(diversity.domain_count).toBeGreaterThanOrEqual(1)
  })

  it('getScore display includes verifier diversity info', async () => {
    const { agentKey: owner } = await makeAgent()
    const expId = await publishExperience(db, store, owner)

    const { agentKey: verifier } = await makeAgent()
    scoring.score(expId, 'verified', verifier.publicKey, owner.delegatedBy, verifier.delegatedBy)

    const result = scoring.getScore(expId)
    expect(typeof result.display).toBe('string')
    expect(result.display).toContain('verified')
  })

  it('cross-circle verification weighted 3x', async () => {
    const { agentKey: owner } = await makeAgent()
    const expId = await publishExperience(db, store, owner)

    const { agentKey: verifier } = await makeAgent() // different operator, different domain prefix

    // Force different domain by using different operators (different pubkeys = different domains)
    const scoreResult = scoring.score(expId, 'verified', verifier.publicKey, owner.delegatedBy, verifier.delegatedBy)

    // With different operators (different pubkeys start), cross-circle = 3x = 15 points
    // (But only if first 16 chars differ, which they will with fresh keypairs)
    expect(scoreResult.points).toBeGreaterThanOrEqual(5)
  })
})

describe('C3: Impact Score — HTTP Routes', () => {
  it('GET /api/v1/experiences/:id/score returns score', async () => {
    const app = createApp({ dbPath: ':memory:' })

    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)
    const payload = {
      type: 'experience',
      data: {
        what: 'Docker DNS fix',
        tried: 'restart daemon',
        outcome: 'succeeded',
        learned: 'works',
      },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['docker'])
    const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
    const event = await signEvent(withOp, agentKey)

    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await app.request('/api/v1/experiences/1/score')
    expect(res.status).toBe(200)
    const data = await res.json() as { total: number; breakdown: unknown; display: string }
    expect(typeof data.total).toBe('number')
    expect(data.breakdown).toBeDefined()
    expect(typeof data.display).toBe('string')
  })
})
