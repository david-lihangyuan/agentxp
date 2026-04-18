// C2b Test Suite: Impact Visibility
// TDD: resolved_hit links back to experience, dashboard text generated.
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
import { ImpactVisibility } from '../src/agentxp/impact-visibility'
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

describe('C2b: Impact Visibility', () => {
  let db: Database.Database
  let store: ExperienceStore
  let pulse: PulseStateMachine
  let impactVis: ImpactVisibility
  let circuitBreaker: CircuitBreaker

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    circuitBreaker = new CircuitBreaker({ threshold: 10000 })
    store = new ExperienceStore(db, circuitBreaker)
    pulse = new PulseStateMachine(db)
    impactVis = new ImpactVisibility(db)
  })

  it('task outcome links back to experience: resolved_hits count', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()

    pulse.recordResolvedHit(expId, searcher.publicKey, 'succeeded')

    const impact = impactVis.getImpact(expId)
    expect(impact.resolved_hits).toBe(1)
    expect(impact.successful_hits).toBe(1)
  })

  it('multiple resolved hits are counted correctly', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)

    const { agentKey: searcher1 } = await makeAgent()
    const { agentKey: searcher2 } = await makeAgent()
    const { agentKey: searcher3 } = await makeAgent()

    pulse.recordResolvedHit(expId, searcher1.publicKey, 'succeeded')
    pulse.recordResolvedHit(expId, searcher2.publicKey, 'succeeded')
    pulse.recordResolvedHit(expId, searcher3.publicKey, 'failed')

    const impact = impactVis.getImpact(expId)
    expect(impact.resolved_hits).toBe(3)
    expect(impact.successful_hits).toBe(2)
    expect(impact.helped_count).toBe(3)
  })

  it('dashboard impact text contains "helped" and "succeed"', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()

    pulse.recordResolvedHit(expId, searcher.publicKey, 'succeeded')

    const impact = impactVis.getImpact(expId)
    expect(impact.display).toContain('helped')
    expect(impact.display.toLowerCase()).toContain('succeed')
  })

  it('zero resolved hits shows "No agents helped yet"', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)

    const impact = impactVis.getImpact(expId)
    expect(impact.resolved_hits).toBe(0)
    expect(impact.display).toContain('No agents helped')
  })

  it('verifications count from impact_ledger', async () => {
    const { agentKey: owner } = await makeAgent()
    const expId = await publishExperience(db, store, owner)

    // Insert a verification into impact_ledger directly
    const now = Math.floor(Date.now() / 1000)
    const { agentKey: verifier } = await makeAgent()
    db.prepare(`INSERT INTO impact_ledger (experience_id, actor_pubkey, action, points, created_at) VALUES (?, ?, 'verified', 5, ?)`)
      .run(expId, verifier.publicKey, now)

    const impact = impactVis.getImpact(expId)
    expect(impact.verifications).toBe(1)
  })
})

describe('C2b: Impact Visibility — HTTP Routes', () => {
  it('GET /api/v1/experiences/:id/impact returns impact data', async () => {
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

    const res = await app.request('/api/v1/experiences/1/impact')
    expect(res.status).toBe(200)
    const data = await res.json() as {
      helped_count: number
      resolved_hits: number
      verifications: number
      display: string
    }
    expect(typeof data.helped_count).toBe('number')
    expect(typeof data.resolved_hits).toBe('number')
    expect(typeof data.verifications).toBe('number')
    expect(typeof data.display).toBe('string')
  })
})
