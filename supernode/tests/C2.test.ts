// C2 Test Suite: Pulse Events Pull API
// TDD: Pull events since timestamp, structured summary, per-agent filtering, resolved_hit, subscription_match.
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
import { PulseStateMachine } from '../src/agentxp/pulse'
import { PulseAPI } from '../src/agentxp/pulse-api'
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

describe('C2: Pulse Events Pull API — Core', () => {
  let db: Database.Database
  let store: ExperienceStore
  let pulseStateMachine: PulseStateMachine
  let pulseAPI: PulseAPI
  let circuitBreaker: CircuitBreaker

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    circuitBreaker = new CircuitBreaker({ threshold: 10000 })
    store = new ExperienceStore(db, circuitBreaker)
    pulseStateMachine = new PulseStateMachine(db)
    pulseAPI = new PulseAPI(db)
  })

  it('returns events since timestamp for this agent', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()
    pulseStateMachine.handleSearchHit(expId, searcher.publicKey, searcher.delegatedBy)

    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600
    const response = pulseAPI.pull({
      pubkey: agentKey.publicKey,
      operatorPubkey: agentKey.delegatedBy,
      since: oneHourAgo,
    })

    expect(Array.isArray(response.highlights)).toBe(true)
    expect(response.highlights.length).toBeGreaterThan(0)
  })

  it('highlights expose the protocol event_id for client-side matching', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()
    pulseStateMachine.handleSearchHit(expId, searcher.publicKey, searcher.delegatedBy)

    const expRow = db
      .prepare('SELECT event_id FROM experiences WHERE id = ?')
      .get(expId) as { event_id: string }
    expect(expRow.event_id).toMatch(/^[0-9a-f]{64}$/)

    const response = pulseAPI.pull({
      pubkey: agentKey.publicKey,
      operatorPubkey: agentKey.delegatedBy,
      since: 0,
    })

    expect(response.highlights.length).toBeGreaterThan(0)
    for (const h of response.highlights) {
      expect(typeof h.event_id).toBe('string')
      expect(h.event_id).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(response.highlights.some((h) => h.event_id === expRow.event_id)).toBe(true)
  })

  it('summary is structured string with counts', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()
    pulseStateMachine.handleSearchHit(expId, searcher.publicKey, searcher.delegatedBy)

    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600
    const response = pulseAPI.pull({
      pubkey: agentKey.publicKey,
      operatorPubkey: agentKey.delegatedBy,
      since: oneHourAgo,
    })

    expect(typeof response.summary).toBe('string')
    expect(response.summary).toMatch(/\d+ discovered/)
  })

  it('only returns events for this agent\'s experiences', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: otherAgent } = await makeAgent()
    const otherExpId = await publishExperience(db, store, otherAgent)

    // Trigger pulse on other agent's experience
    const { agentKey: searcher } = await makeAgent()
    pulseStateMachine.handleSearchHit(otherExpId, searcher.publicKey, searcher.delegatedBy)

    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600
    const response = pulseAPI.pull({
      pubkey: agentKey.publicKey,
      operatorPubkey: agentKey.delegatedBy,
      since: oneHourAgo,
    })

    // Should only see events for own experiences
    for (const highlight of response.highlights) {
      expect(highlight.owner_pubkey).toBe(agentKey.delegatedBy)
    }
  })

  it('resolved_hit events include outcome', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()

    pulseAPI.reportOutcome({
      experienceId: expId,
      reporterPubkey: searcher.publicKey,
      outcome: 'succeeded',
    })

    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600
    const response = pulseAPI.pull({
      pubkey: agentKey.publicKey,
      operatorPubkey: agentKey.delegatedBy,
      since: oneHourAgo,
    })

    const hit = response.highlights.find((e) => e.type === 'resolved_hit')
    expect(hit).toBeDefined()
    expect(hit!.outcome).toBe('succeeded')
  })

  it('no events returns empty highlights with "no events" summary', async () => {
    const { agentKey } = await makeAgent()
    const response = pulseAPI.pull({
      pubkey: agentKey.publicKey,
      operatorPubkey: agentKey.delegatedBy,
      since: Math.floor(Date.now() / 1000),
    })
    expect(response.highlights).toHaveLength(0)
    expect(response.summary).toBe('no events')
  })
})

describe('C2: Pulse Events — HTTP Routes', () => {
  it('GET /api/v1/pulse returns pulse events', async () => {
    const app = createApp({ dbPath: ':memory:' })

    // Publish an experience first
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

    const since = Math.floor(Date.now() / 1000) - 3600
    const res = await app.request(
      `/api/v1/pulse?pubkey=${agentKey.delegatedBy}&since=${since}`
    )
    expect(res.status).toBe(200)
    const data = await res.json() as { highlights: unknown[]; summary: string }
    expect(Array.isArray(data.highlights)).toBe(true)
    expect(typeof data.summary).toBe('string')
  })

  it('GET /api/v1/pulse requires pubkey', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/pulse?since=0')
    expect(res.status).toBe(400)
  })

  it('POST /api/v1/pulse/outcome reports task outcome', async () => {
    const app = createApp({ dbPath: ':memory:' })

    // Publish experience
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

    const publishRes = await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(publishRes.status).toBe(201)

    // Get experience id from db — we'll use experience_id=1 for the test
    const { agentKey: searcher } = await makeAgent()
    const outcomeRes = await app.request('/api/v1/pulse/outcome', {
      method: 'POST',
      body: JSON.stringify({
        experience_id: 1,
        reporter_pubkey: searcher.publicKey,
        outcome: 'succeeded',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(outcomeRes.status).toBe(201)
  })

  it('POST /api/v1/pulse/outcome validates required fields', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/pulse/outcome', {
      method: 'POST',
      body: JSON.stringify({ experience_id: 1 }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })
})

async function makeAgent2() {
  const opKey = await generateOperatorKey()
  const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)
  return { opKey, agentKey }
}
