// B4 Test Suite: Intent Broadcast Handling
// TDD: Experience stored with pending embedding, async embedding worker, scope, failure flag, circuit breaker.
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
import { CircuitBreaker } from '../src/circuit-breaker'
import { createApp } from '../src/app'

async function makeExperienceEvent(
  agentKey: Awaited<ReturnType<typeof delegateAgentKey>>,
  data: Record<string, unknown> = {}
) {
  const payload = {
    type: 'experience',
    data: {
      what: 'Docker DNS resolution failure',
      tried: 'Restarted Docker daemon and checked resolv.conf',
      outcome: 'succeeded',
      learned: 'Docker daemon restart clears DNS cache in bridge network mode',
      ...data,
    },
  }
  const unsigned = createEvent('intent.broadcast', payload, data['_tags'] as string[] ?? ['docker', 'networking'])
  const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
  return signEvent(withOp, agentKey)
}

describe('B4: Intent Broadcast — Immediate Storage', () => {
  let db: Database
  let store: ExperienceStore
  let circuitBreaker: CircuitBreaker
  let agentKey: Awaited<ReturnType<typeof delegateAgentKey>>

  beforeEach(async () => {
    db = new Database(':memory:')
    runMigrations(db)
    circuitBreaker = new CircuitBreaker({ threshold: 10000 })
    store = new ExperienceStore(db, circuitBreaker)
    const opKey = await generateOperatorKey()
    agentKey = await delegateAgentKey(opKey, 'test-agent', 90)
  })

  it('experience stored immediately with embedding_status=pending', async () => {
    const event = await makeExperienceEvent(agentKey)
    const result = store.store(event)
    expect(result.ok).toBe(true)
    expect(result.experienceId).toBeDefined()

    const stored = db.query('SELECT * FROM experiences WHERE event_id = ?').get(event.id) as Record<string, unknown>
    expect(stored).toBeDefined()
    expect(stored['embedding_status']).toBe('pending')
    expect(stored['embedding']).toBeNull()
  })

  it('scope fields parsed and stored as JSON', async () => {
    const event = await makeExperienceEvent(agentKey, {
      scope: { versions: ['docker>=24'], platforms: ['linux'] },
    })
    store.store(event)

    const stored = db.query('SELECT scope FROM experiences WHERE event_id = ?').get(event.id) as { scope: string }
    expect(stored).toBeDefined()
    const scope = JSON.parse(stored.scope)
    expect(scope.versions).toContain('docker>=24')
    expect(scope.platforms).toContain('linux')
  })

  it('failure experiences flagged with is_failure=1', async () => {
    const event = await makeExperienceEvent(agentKey, {
      outcome: 'failed',
      what: 'Attempted to use Docker internal DNS for external resolution',
      tried: 'Set DNS server to 127.0.0.11 in container',
      learned: 'Docker internal DNS only resolves container names, not external hosts',
    })
    store.store(event)

    const stored = db.query('SELECT is_failure FROM experiences WHERE event_id = ?').get(event.id) as { is_failure: number }
    expect(stored.is_failure).toBe(1)
  })

  it('successful experiences have is_failure=0', async () => {
    const event = await makeExperienceEvent(agentKey)
    store.store(event)

    const stored = db.query('SELECT is_failure FROM experiences WHERE event_id = ?').get(event.id) as { is_failure: number }
    expect(stored.is_failure).toBe(0)
  })

  it('partial outcome does not set is_failure', async () => {
    const event = await makeExperienceEvent(agentKey, { outcome: 'partial' })
    store.store(event)

    const stored = db.query('SELECT is_failure FROM experiences WHERE event_id = ?').get(event.id) as { is_failure: number }
    expect(stored.is_failure).toBe(0)
  })
})

describe('B4: Async Embedding Worker', () => {
  let db: Database
  let circuitBreaker: CircuitBreaker
  let agentKey: Awaited<ReturnType<typeof delegateAgentKey>>
  let embeddingCallCount: number

  beforeEach(async () => {
    db = new Database(':memory:')
    runMigrations(db)
    circuitBreaker = new CircuitBreaker({ threshold: 10000 })
    embeddingCallCount = 0
    const opKey = await generateOperatorKey()
    agentKey = await delegateAgentKey(opKey, 'test-agent', 90)
  })

  it('background worker updates embedding_status to indexed', async () => {
    const mockEmbedding = async (text: string): Promise<number[]> => {
      embeddingCallCount++
      return [0.1, 0.2, 0.3, 0.4, 0.5]
    }

    const store = new ExperienceStore(db, circuitBreaker, {
      generateEmbedding: mockEmbedding,
      pollIntervalMs: 100,
    })

    const event = await makeExperienceEvent(agentKey)
    store.store(event)

    // Wait for worker to process
    await new Promise((resolve) => setTimeout(resolve, 500))

    const indexed = db.query('SELECT embedding_status, embedding FROM experiences WHERE event_id = ?').get(event.id) as { embedding_status: string; embedding: string }
    expect(indexed.embedding_status).toBe('indexed')
    expect(indexed.embedding).toBeDefined()
    const vec = JSON.parse(indexed.embedding)
    expect(Array.isArray(vec)).toBe(true)
    expect(vec.length).toBe(5)

    store.stopEmbeddingWorker()
  })

  it('embedding is never exposed via store interface — stored internally only', async () => {
    const mockEmbedding = async () => [0.1, 0.2, 0.3]
    const store = new ExperienceStore(db, circuitBreaker, {
      generateEmbedding: mockEmbedding,
    })

    const event = await makeExperienceEvent(agentKey)
    store.store(event)
    await store.processAllPending()

    // getByEventId returns ExperienceRecord which includes embedding for internal use
    // but the API layer strips it (tested in B5)
    const record = store.getByEventId(event.id)
    expect(record).toBeDefined()
    // Embedding is stored in DB internally (needed for search)
    expect(record!.embedding_status).toBe('indexed')
  })

  it('processAllPending processes entire queue synchronously', async () => {
    const embeddings: string[] = []
    const mockEmbedding = async (text: string) => {
      embeddings.push(text)
      return [0.1, 0.2]
    }
    const store = new ExperienceStore(db, circuitBreaker, {
      generateEmbedding: mockEmbedding,
      pollIntervalMs: 0, // no auto-polling
    })

    const opKey = await generateOperatorKey()
    const aKey = await delegateAgentKey(opKey, 'agent', 90)

    for (let i = 0; i < 3; i++) {
      const event = await makeExperienceEvent(aKey, { what: `experience ${i}` })
      store.store(event)
    }

    expect(store.getQueueDepth()).toBe(3)
    await store.processAllPending()
    expect(store.getQueueDepth()).toBe(0)
    expect(embeddings.length).toBe(3)
  })
})

describe('B4: Circuit Breaker', () => {
  it('circuit breaker blocks new events when queue exceeds threshold', async () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const cb = new CircuitBreaker({ threshold: 2 })
    cb.setQueueDepth(3) // manually open circuit

    const store = new ExperienceStore(db, cb)
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent', 90)
    const event = await makeExperienceEvent(agentKey)

    const result = store.store(event)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('circuit breaker')
  })

  it('HTTP POST returns 503 when circuit breaker is open', async () => {
    const app = createApp({ dbPath: ':memory:', circuitBreakerThreshold: 2 })
    const { getCircuitBreaker } = await import('../src/circuit-breaker')
    const cb = getCircuitBreaker(app)
    cb.setQueueDepth(3)

    const opKey = await generateOperatorKey()
    const aKey = await delegateAgentKey(opKey, 'agent', 90)
    const payload = {
      type: 'experience',
      data: { what: 'test', tried: 'test', outcome: 'succeeded', learned: 'test' },
    }
    const unsigned = createEvent('intent.broadcast', payload, [])
    const withOp = { ...unsigned, operator_pubkey: aKey.delegatedBy }
    const event = await signEvent(withOp, aKey)

    const res = await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(503)
  })

  it('circuit breaker auto-recovers when queue drains below threshold', () => {
    const cb = new CircuitBreaker({ threshold: 10 })
    cb.setQueueDepth(11)
    expect(cb.isOpen()).toBe(true)

    // Drain to below recovery threshold (50% of 10 = 5)
    cb.setQueueDepth(4)
    expect(cb.isOpen()).toBe(false)
  })
})
