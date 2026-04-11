// C1 Test Suite: Pulse State Machine
// TDD: dormant → discovered → verified → propagating; anti-gaming; invalid transitions rejected.
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

describe('C1: Pulse State Machine', () => {
  let db: Database.Database
  let store: ExperienceStore
  let pulse: PulseStateMachine
  let circuitBreaker: CircuitBreaker

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    circuitBreaker = new CircuitBreaker({ threshold: 10000 })
    store = new ExperienceStore(db, circuitBreaker)
    pulse = new PulseStateMachine(db)
  })

  it('published experience starts as dormant', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    expect(pulse.getPulseState(expId)).toBe('dormant')
  })

  it('cross-operator search hit transitions dormant → discovered', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)

    const { agentKey: searcherKey } = await makeAgent() // different operator
    pulse.handleSearchHit(expId, searcherKey.publicKey, searcherKey.delegatedBy)

    expect(pulse.getPulseState(expId)).toBe('discovered')
  })

  it('same-operator search hit does NOT transition state (anti-gaming)', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)

    // Same operator, different agent
    const sameOpKey = await delegateAgentKey(
      { publicKey: agentKey.delegatedBy, privateKey: '' as unknown as Uint8Array },
      'other-agent',
      90
    )
    pulse.handleSearchHit(expId, sameOpKey.publicKey, sameOpKey.delegatedBy)

    expect(pulse.getPulseState(expId)).toBe('dormant')
  })

  it('transition to verified from discovered', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()
    pulse.handleSearchHit(expId, searcher.publicKey, searcher.delegatedBy)

    const result = pulse.transitionPulse(expId, 'verified', 'confirmed by verifier')
    expect(result.ok).toBe(true)
    expect(pulse.getPulseState(expId)).toBe('verified')
  })

  it('transition to propagating from verified', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()
    pulse.handleSearchHit(expId, searcher.publicKey, searcher.delegatedBy)
    pulse.transitionPulse(expId, 'verified', 'confirmed')
    const result = pulse.transitionPulse(expId, 'propagating', 'cited by agent')
    expect(result.ok).toBe(true)
    expect(pulse.getPulseState(expId)).toBe('propagating')
  })

  it('invalid transition dormant → propagating is rejected', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const result = pulse.transitionPulse(expId, 'propagating', 'skip verified')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('invalid transition')
  })

  it('invalid transition dormant → verified is rejected', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const result = pulse.transitionPulse(expId, 'verified', 'skip discovered')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('invalid transition')
  })

  it('each transition is logged to pulse_events table', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()
    pulse.handleSearchHit(expId, searcher.publicKey, searcher.delegatedBy)

    const events = db
      .prepare('SELECT * FROM pulse_events WHERE experience_id = ?')
      .all(expId) as Array<{ type: string }>
    expect(events.some((e) => e.type === 'discovered')).toBe(true)
  })

  it('resolved_hit recorded when searching agent reports task outcome', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const { agentKey: searcher } = await makeAgent()

    const result = pulse.recordResolvedHit(expId, searcher.publicKey, 'succeeded')
    expect(result.ok).toBe(true)

    const resolvedHit = db
      .prepare("SELECT * FROM pulse_events WHERE experience_id = ? AND type = 'resolved_hit'")
      .get(expId) as { outcome: string } | undefined
    expect(resolvedHit).toBeDefined()
    expect(resolvedHit!.outcome).toBe('succeeded')
  })

  it('cannot transition to dormant', async () => {
    const { agentKey } = await makeAgent()
    const expId = await publishExperience(db, store, agentKey)
    const result = pulse.transitionPulse(expId, 'dormant' as any, 'reset')
    expect(result.ok).toBe(false)
  })
})
