// HL3 Test Suite: Human Direct Contribution
// TDD: POST stores human experience with contributor_type='human', trust_weight=2.0
//       GET /experiences?contributor_type=human filters correctly.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'
import { storeHumanContribution } from '../src/agentxp/human-layer/human-contribution'
import { generateOperatorKey, delegateAgentKey, createEvent, signEvent } from '@serendip/protocol'
import type { OperatorKey, AgentKey, SerendipEvent, SerendipKind } from '@serendip/protocol'

// Build a SerendipEvent signed directly by the operator, as required by the
// verifyOperatorEvent gate on POST /operator/:pubkey/contribute.
async function signContributionEvent(
  opKey: OperatorKey,
  data: Record<string, unknown>,
): Promise<SerendipEvent> {
  const opAsAgent: AgentKey = {
    publicKey: opKey.publicKey,
    privateKey: opKey.privateKey,
    delegatedBy: opKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
  }
  const unsigned = createEvent(
    'operator.human_contribution' as SerendipKind,
    { type: 'human_contribution', data },
    [],
  )
  const withVis = { ...unsigned, visibility: 'private' as const }
  return signEvent(withVis, opAsAgent)
}

describe('HL3: Human Direct Contribution', () => {
  let app: ReturnType<typeof createApp>
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  // Test 1: POST /api/v1/operator/:pubkey/contribute stores experience
  it('POST /api/v1/operator/:pubkey/contribute stores human contribution', async () => {
    const opKey = await generateOperatorKey()
    const event = await signContributionEvent(opKey, {
      what: '20 years of distributed systems: this failure pattern destroys startups',
      tried: 'standard retry with exponential backoff',
      outcome: 'failed',
      learned: 'retry amplifies the problem during thundering herd — use circuit breaker first',
      tags: ['distributed-systems', 'circuit-breaker'],
    })

    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/contribute`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { ok: boolean; id: number }
    expect(body.ok).toBe(true)
    expect(typeof body.id).toBe('number')
  })

  // Test 2: Human contribution marked with contributor_type='human'
  it('human contribution stored with contributor_type=human', async () => {
    const opKey = await generateOperatorKey()
    const result = storeHumanContribution(db, opKey.publicKey, {
      what: 'Hard-won lesson about circuit breakers',
      tried: 'retry',
      outcome: 'failed',
      learned: 'use circuit breakers',
      tags: ['reliability'],
    })
    expect(result.ok).toBe(true)

    const stored = db
      .prepare('SELECT contributor_type, trust_weight FROM experiences WHERE operator_pubkey = ?')
      .get(opKey.publicKey) as { contributor_type: string; trust_weight: number } | undefined
    expect(stored).toBeDefined()
    expect(stored!.contributor_type).toBe('human')
  })

  // Test 3: Human contribution has higher trust weight (2.0 vs default 1.0)
  it('human contribution has trust_weight=2.0 vs agent default 1.0', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)

    // Store agent experience via protocol event
    const payload = { type: 'experience', data: { what: 'Agent lesson', tried: 'try', outcome: 'succeeded', learned: 'agent learned' } }
    const unsigned = createEvent('intent.broadcast', payload, ['test'])
    const withOp = { ...unsigned, operator_pubkey: opKey.publicKey }
    const event = await signEvent(withOp, agentKey)
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    })

    // Store human contribution
    storeHumanContribution(db, opKey.publicKey, {
      what: 'Human direct lesson',
      tried: 'human tried',
      outcome: 'succeeded',
      learned: 'human learned',
    })

    const agentExp = db
      .prepare("SELECT trust_weight FROM experiences WHERE contributor_type = 'agent' LIMIT 1")
      .get() as { trust_weight: number } | undefined
    const humanExp = db
      .prepare("SELECT trust_weight FROM experiences WHERE contributor_type = 'human' LIMIT 1")
      .get() as { trust_weight: number } | undefined

    expect(agentExp).toBeDefined()
    expect(humanExp).toBeDefined()
    expect(humanExp!.trust_weight).toBeGreaterThan(agentExp!.trust_weight)
    expect(humanExp!.trust_weight).toBe(2.0)
    expect(agentExp!.trust_weight).toBe(1.0)
  })

  // Test 4: GET /api/v1/experiences?contributor_type=human filters correctly
  it('GET /api/v1/experiences?contributor_type=human returns only human contributions', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-agent-hl3', 90)

    // Add agent experience
    const payload = { type: 'experience', data: { what: 'Agent experience', tried: 'try', outcome: 'succeeded', learned: 'learned' } }
    const unsigned = createEvent('intent.broadcast', payload, ['test'])
    const withOp = { ...unsigned, operator_pubkey: opKey.publicKey }
    const event = await signEvent(withOp, agentKey)
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    })

    // Add human contribution
    storeHumanContribution(db, opKey.publicKey, {
      what: 'Human direct contribution',
      learned: 'human lesson',
    })

    const res = await app.request('/api/v1/experiences?contributor_type=human')
    expect(res.status).toBe(200)
    const body = await res.json() as { experiences: Array<{ contributor_type: string }> }
    expect(Array.isArray(body.experiences)).toBe(true)
    expect(body.experiences.length).toBeGreaterThan(0)
    for (const exp of body.experiences) {
      expect(exp.contributor_type).toBe('human')
    }
  })

  // Test 6: POST with content field (simple form) works
  it('POST with content field stores human contribution', async () => {
    const opKey = await generateOperatorKey()
    const event = await signContributionEvent(opKey, { content: 'Simple lesson from experience', tags: ['general'] })
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/contribute`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(201)
  })

  // Test 7: POST with missing content returns 400
  it('POST contribute with no content returns 400', async () => {
    const opKey = await generateOperatorKey()
    const event = await signContributionEvent(opKey, { tags: ['test'] })
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/contribute`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  // Test 8: POST without event envelope returns 400
  it('POST without event envelope returns 400', async () => {
    const opKey = await generateOperatorKey()
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/contribute`, {
      method: 'POST',
      body: JSON.stringify({ what: 'unsigned', learned: 'unsigned' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  // Test 9: POST with event signed by a different operator returns 401
  it('POST with pubkey mismatch returns 401', async () => {
    const opKey = await generateOperatorKey()
    const otherKey = await generateOperatorKey()
    const event = await signContributionEvent(otherKey, { what: 'forged', learned: 'forged' })
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/contribute`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  // Test 10: POST with tampered signature returns 401
  it('POST with tampered signature returns 401', async () => {
    const opKey = await generateOperatorKey()
    const event = await signContributionEvent(opKey, { what: 'original', learned: 'original' })
    const tampered = { ...event, sig: event.sig.replace(/.$/, (c) => (c === '0' ? '1' : '0')) }
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/contribute`, {
      method: 'POST',
      body: JSON.stringify({ event: tampered }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })
})
