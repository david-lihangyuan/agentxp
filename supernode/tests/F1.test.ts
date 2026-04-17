// F1 Test Suite: Dashboard Data API
// TDD: operator summary, growth timeline, failure impact, experience list, network overview.
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
import { createApp } from '../src/app'

async function makeAgent() {
  const opKey = await generateOperatorKey()
  const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)
  return { opKey, agentKey }
}

async function publishExperience(
  app: ReturnType<typeof createApp>,
  agentKey: Awaited<ReturnType<typeof delegateAgentKey>>,
  overrides: Record<string, unknown> = {}
): Promise<void> {
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
  await app.request('/api/v1/events', {
    method: 'POST',
    body: JSON.stringify(event),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('F1: Dashboard Data API', () => {
  let app: ReturnType<typeof createApp>
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  // Test 1: Operator summary endpoint
  it('GET /api/v1/dashboard/operator/:pubkey/summary returns summary', async () => {
    const { opKey, agentKey } = await makeAgent()
    await publishExperience(app, agentKey)

    const res = await app.request(`/api/v1/dashboard/operator/${opKey.publicKey}/summary`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['agent_count']).toBeDefined()
    expect(body['experience_count']).toBeDefined()
    expect(body['verified_count']).toBeDefined()
    expect(body['search_hits']).toBeDefined()
    expect(body['reflection_streak']).toBeDefined()
    expect(body['top_lessons']).toBeDefined()
    expect(typeof body['experience_count']).toBe('number')
    expect((body['experience_count'] as number)).toBeGreaterThanOrEqual(1)
  })

  // Test 2: Growth timeline endpoint
  it('GET /api/v1/dashboard/operator/:pubkey/growth returns growth data', async () => {
    const { opKey, agentKey } = await makeAgent()
    await publishExperience(app, agentKey)

    const res = await app.request(`/api/v1/dashboard/operator/${opKey.publicKey}/growth`)
    expect(res.status).toBe(200)
    const g = await res.json() as Record<string, unknown>
    expect(g['monthly']).toBeDefined()
    expect(Array.isArray(g['monthly'])).toBe(true)
    expect(g['milestones']).toBeDefined()
    expect(Array.isArray(g['milestones'])).toBe(true)
    expect(g['current_verification_rate']).toBeDefined()
  })

  // Test 3: Monthly summary has correct shape
  it('growth monthly summary has required fields', async () => {
    const { opKey, agentKey } = await makeAgent()
    await publishExperience(app, agentKey)

    const res = await app.request(`/api/v1/dashboard/operator/${opKey.publicKey}/growth`)
    const g = await res.json() as { monthly: Array<Record<string, unknown>> }
    if (g.monthly.length > 0) {
      const month = g.monthly[0]!
      expect(month['month']).toBeDefined()
      expect(month['published']).toBeDefined()
      expect(month['verified']).toBeDefined()
      expect(month['verification_rate']).toBeDefined()
    }
  })

  // Test 4: Milestones include first_experience
  it('growth milestones include first_experience after first publish', async () => {
    const { opKey, agentKey } = await makeAgent()
    await publishExperience(app, agentKey)

    const res = await app.request(`/api/v1/dashboard/operator/${opKey.publicKey}/growth`)
    const g = await res.json() as { milestones: Array<{ type: string; date: string; display: string }> }
    const types = g.milestones.map(m => m.type)
    expect(types).toContain('first_experience')
    // Each milestone has required fields
    for (const m of g.milestones) {
      expect(m.type).toBeDefined()
      expect(m.date).toBeDefined()
      expect(m.display).toBeDefined()
    }
  })

  // Test 5: Failure impact stats
  it('GET /api/v1/dashboard/operator/:pubkey/failures returns failure impact', async () => {
    const { opKey, agentKey } = await makeAgent()
    await publishExperience(app, agentKey, { outcome: 'failed' })

    const res = await app.request(`/api/v1/dashboard/operator/${opKey.publicKey}/failures`)
    expect(res.status).toBe(200)
    const fi = await res.json() as Record<string, unknown>
    expect(fi['failure_count']).toBeDefined()
    expect(fi['helped_others_count']).toBeDefined()
    expect(fi['display']).toBeDefined()
    expect(typeof fi['display']).toBe('string')
    expect((fi['display'] as string)).toContain('helped')
  })

  // Test 6: Experience list includes scope and dialogue relations
  it('GET /api/v1/dashboard/experiences returns experiences with scope and relations', async () => {
    const { agentKey } = await makeAgent()
    await publishExperience(app, agentKey, {
      scope: { versions: ['1.0', '2.0'], platforms: ['linux'] },
    })

    const res = await app.request('/api/v1/dashboard/experiences')
    expect(res.status).toBe(200)
    const list = await res.json() as { experiences: Array<Record<string, unknown>> }
    expect(Array.isArray(list.experiences)).toBe(true)
    expect(list.experiences.length).toBeGreaterThanOrEqual(1)
    const exp = list.experiences[0]!
    expect(exp['scope']).toBeDefined()
    expect(exp['relations']).toBeDefined()
    expect(exp['pulse_state']).toBeDefined()
    expect(exp['operator_pubkey']).toBeDefined()
  })

  // Test 7: Network overview endpoint
  it('GET /api/v1/dashboard/network returns network stats', async () => {
    const { agentKey } = await makeAgent()
    await publishExperience(app, agentKey)

    const res = await app.request('/api/v1/dashboard/network')
    expect(res.status).toBe(200)
    const net = await res.json() as Record<string, unknown>
    expect(net['total_experiences']).toBeDefined()
    expect(net['total_agents']).toBeDefined()
    expect(net['verification_rate']).toBeDefined()
    expect(net['top_tags']).toBeDefined()
    expect(net['contributor_count']).toBeDefined()
  })

  // Test 8: Unknown operator returns 404
  it('unknown operator pubkey returns 404 on summary', async () => {
    const unknownPubkey = 'f'.repeat(64)
    const res = await app.request(`/api/v1/dashboard/operator/${unknownPubkey}/summary`)
    expect(res.status).toBe(404)
  })

  // Test 9: Unknown operator returns 404 on growth
  it('unknown operator pubkey returns 404 on growth', async () => {
    const unknownPubkey = 'f'.repeat(64)
    const res = await app.request(`/api/v1/dashboard/operator/${unknownPubkey}/growth`)
    expect(res.status).toBe(404)
  })

  // Test 10: Unknown operator returns 404 on failures
  it('unknown operator pubkey returns 404 on failures', async () => {
    const unknownPubkey = 'f'.repeat(64)
    const res = await app.request(`/api/v1/dashboard/operator/${unknownPubkey}/failures`)
    expect(res.status).toBe(404)
  })
})
