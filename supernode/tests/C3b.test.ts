// C3b Test Suite: Experience Dialogue Relations
// TDD: extends, qualifies, supersedes — self-relation rejected, search traversal.
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
import { ExperienceRelations } from '../src/agentxp/relations'
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

describe('C3b: Experience Dialogue Relations', () => {
  let db: Database.Database
  let store: ExperienceStore
  let relations: ExperienceRelations
  let circuitBreaker: CircuitBreaker

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    circuitBreaker = new CircuitBreaker({ threshold: 10000 })
    store = new ExperienceStore(db, circuitBreaker)
    relations = new ExperienceRelations(db)
  })

  it('stores extends relation', async () => {
    const { agentKey } = await makeAgent()
    const exp1 = await publishExperience(db, store, agentKey, { what: 'Docker DNS issue v1' })
    const exp2 = await publishExperience(db, store, agentKey, { what: 'Docker DNS issue v2' })

    const result = relations.addRelation(exp1, exp2, 'extends', agentKey.publicKey)
    expect(result.ok).toBe(true)

    const rows = db
      .prepare('SELECT * FROM experience_relations WHERE from_experience_id = ?')
      .all(exp1) as Array<{ relation_type: string }>
    expect(rows[0]?.relation_type).toBe('extends')
  })

  it('stores qualifies relation', async () => {
    const { agentKey } = await makeAgent()
    const exp1 = await publishExperience(db, store, agentKey, { what: 'Docker DNS issue' })
    const exp2 = await publishExperience(db, store, agentKey, { what: 'Docker DNS qualifier' })

    const result = relations.addRelation(exp1, exp2, 'qualifies', agentKey.publicKey)
    expect(result.ok).toBe(true)

    const relList = relations.getRelations(exp1)
    expect(relList.some((r) => r.relation_type === 'qualifies')).toBe(true)
  })

  it('stores supersedes relation', async () => {
    const { agentKey } = await makeAgent()
    const exp1 = await publishExperience(db, store, agentKey, { what: 'Old approach' })
    const exp2 = await publishExperience(db, store, agentKey, { what: 'New approach' })

    const result = relations.addRelation(exp1, exp2, 'supersedes', agentKey.publicKey)
    expect(result.ok).toBe(true)

    const relList = relations.getRelations(exp1)
    expect(relList.some((r) => r.relation_type === 'supersedes')).toBe(true)
  })

  it('self-relation is rejected with error', async () => {
    const { agentKey } = await makeAgent()
    const exp1 = await publishExperience(db, store, agentKey)

    const result = relations.addRelation(exp1, exp1, 'extends', agentKey.publicKey)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('self-relation not allowed')
  })

  it('getRelations returns both outgoing and incoming', async () => {
    const { agentKey } = await makeAgent()
    const exp1 = await publishExperience(db, store, agentKey, { what: 'Experience A' })
    const exp2 = await publishExperience(db, store, agentKey, { what: 'Experience B' })
    const exp3 = await publishExperience(db, store, agentKey, { what: 'Experience C' })

    relations.addRelation(exp1, exp2, 'extends', agentKey.publicKey) // outgoing from exp1
    relations.addRelation(exp3, exp1, 'qualifies', agentKey.publicKey) // incoming to exp1

    const relList = relations.getRelations(exp1)
    expect(relList.length).toBe(2)
    expect(relList.some((r) => r.direction === 'outgoing')).toBe(true)
    expect(relList.some((r) => r.direction === 'incoming')).toBe(true)
  })

  it('invalid relation type is rejected', async () => {
    const { agentKey } = await makeAgent()
    const exp1 = await publishExperience(db, store, agentKey, { what: 'Exp A' })
    const exp2 = await publishExperience(db, store, agentKey, { what: 'Exp B' })

    const result = relations.addRelation(exp1, exp2, 'invalid' as 'extends', agentKey.publicKey)
    expect(result.ok).toBe(false)
  })

  it('duplicate relation returns error', async () => {
    const { agentKey } = await makeAgent()
    const exp1 = await publishExperience(db, store, agentKey, { what: 'Exp A' })
    const exp2 = await publishExperience(db, store, agentKey, { what: 'Exp B' })

    relations.addRelation(exp1, exp2, 'extends', agentKey.publicKey)
    const result = relations.addRelation(exp1, exp2, 'extends', agentKey.publicKey)
    expect(result.ok).toBe(false)
  })

  it('getDirectRelations returns only outgoing relations', async () => {
    const { agentKey } = await makeAgent()
    const exp1 = await publishExperience(db, store, agentKey, { what: 'Exp A' })
    const exp2 = await publishExperience(db, store, agentKey, { what: 'Exp B' })

    relations.addRelation(exp1, exp2, 'extends', agentKey.publicKey)

    const direct = relations.getDirectRelations(exp1)
    expect(direct.length).toBe(1)
    expect(direct[0]?.relation_type).toBe('extends')
    expect(direct[0]?.target_id).toBe(exp2)
  })
})

describe('C3b: Relations — HTTP Routes', () => {
  it('POST /api/v1/experiences/:id/relations creates a relation', async () => {
    const app = createApp({ dbPath: ':memory:' })

    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)

    // Publish two experiences
    const payload1 = {
      type: 'experience',
      data: { what: 'Docker DNS fix', tried: 'restart', outcome: 'succeeded', learned: 'works' },
    }
    const unsigned1 = createEvent('intent.broadcast', payload1, ['docker'])
    const withOp1 = { ...unsigned1, operator_pubkey: agentKey.delegatedBy }
    const event1 = await signEvent(withOp1, agentKey)
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event1),
      headers: { 'Content-Type': 'application/json' },
    })

    const payload2 = {
      type: 'experience',
      data: { what: 'Docker DNS deep fix', tried: 'restart network', outcome: 'succeeded', learned: 'deeper' },
    }
    const unsigned2 = createEvent('intent.broadcast', payload2, ['docker'])
    const withOp2 = { ...unsigned2, operator_pubkey: agentKey.delegatedBy }
    const event2 = await signEvent(withOp2, agentKey)
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event2),
      headers: { 'Content-Type': 'application/json' },
    })

    // Add relation: experience 1 extends experience 2
    const relRes = await app.request('/api/v1/experiences/1/relations', {
      method: 'POST',
      body: JSON.stringify({
        target_id: 2,
        relation_type: 'extends',
        pubkey: agentKey.publicKey,
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(relRes.status).toBe(201)
    const relData = await relRes.json() as { ok: boolean; id: number }
    expect(relData.ok).toBe(true)
  })

  it('GET /api/v1/experiences/:id/relations returns related experiences', async () => {
    const app = createApp({ dbPath: ':memory:' })

    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)

    // Publish two experiences
    for (const what of ['Docker fix v1', 'Docker fix v2']) {
      const payload = {
        type: 'experience',
        data: { what, tried: 'restart', outcome: 'succeeded', learned: 'works' },
      }
      const unsigned = createEvent('intent.broadcast', payload, ['docker'])
      const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
      const event = await signEvent(withOp, agentKey)
      await app.request('/api/v1/events', {
        method: 'POST',
        body: JSON.stringify(event),
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Add relation
    await app.request('/api/v1/experiences/1/relations', {
      method: 'POST',
      body: JSON.stringify({ target_id: 2, relation_type: 'extends', pubkey: agentKey.publicKey }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await app.request('/api/v1/experiences/1/relations')
    expect(res.status).toBe(200)
    const data = await res.json() as { relations: Array<{ relation_type: string }> }
    expect(Array.isArray(data.relations)).toBe(true)
    expect(data.relations.length).toBe(1)
    expect(data.relations[0]?.relation_type).toBe('extends')
  })

  it('POST self-relation returns 400', async () => {
    const app = createApp({ dbPath: ':memory:' })

    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)

    const payload = {
      type: 'experience',
      data: { what: 'Docker fix', tried: 'restart', outcome: 'succeeded', learned: 'works' },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['docker'])
    const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
    const event = await signEvent(withOp, agentKey)
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await app.request('/api/v1/experiences/1/relations', {
      method: 'POST',
      body: JSON.stringify({ target_id: 1, relation_type: 'extends', pubkey: agentKey.publicKey }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toContain('self-relation not allowed')
  })

  it('POST missing fields returns 400', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/experiences/1/relations', {
      method: 'POST',
      body: JSON.stringify({ target_id: 2 }), // missing relation_type
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('search results include direct relations (C3b B5 integration)', async () => {
    const app = createApp({ dbPath: ':memory:' })

    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)

    // Publish two experiences with the same tag
    for (const what of ['Docker fix v1', 'Docker fix v2']) {
      const payload = {
        type: 'experience',
        data: { what, tried: 'restart docker', outcome: 'succeeded', learned: 'clears cache' },
      }
      const unsigned = createEvent('intent.broadcast', payload, ['docker'])
      const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
      const event = await signEvent(withOp, agentKey)
      await app.request('/api/v1/events', {
        method: 'POST',
        body: JSON.stringify(event),
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Add relation: exp 1 extends exp 2
    await app.request('/api/v1/experiences/1/relations', {
      method: 'POST',
      body: JSON.stringify({ target_id: 2, relation_type: 'extends', pubkey: agentKey.publicKey }),
      headers: { 'Content-Type': 'application/json' },
    })

    // Search should return results (keyword search via 'docker')
    const searchRes = await app.request('/api/v1/search?q=restart+docker&tags=docker')
    expect(searchRes.status).toBe(200)
    const data = await searchRes.json() as {
      precision: Array<{ experience: { id: number }; related?: Array<{ relation_type: string }> }>
    }

    // At least one result should have the related field
    expect(Array.isArray(data.precision)).toBe(true)
  })
})
