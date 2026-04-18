// I1: End-to-end integration test
// install skill → reflect → publish → relay receives → dashboard shows
import { describe, it, expect } from 'vitest'
import { createApp } from '../supernode/src/app'
import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
} from '../packages/protocol/src/index'

describe('I1: End-to-end integration', () => {
  it('POST event → experience stored → dashboard/network shows it', async () => {
    const app = createApp({ dbPath: ':memory:' })

    // 1. POST a properly signed intent.broadcast experience event
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey)

    const payload = {
      type: 'experience',
      data: {
        what: 'LangChain retry parser test',
        tried: 'Used RetryOutputParser with max_retries=3',
        outcome: 'succeeded',
        learned: 'Set max_retries=1 to avoid loops',
      },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['langchain', 'retry'])
    const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
    const event = await signEvent(withOp, agentKey)

    const postRes = await app.request('/api/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    expect(postRes.status).toBe(201)

    // 2. Experience shows in list
    const listRes = await app.request('/api/v1/experiences')
    expect(listRes.status).toBe(200)
    const list = await listRes.json() as { experiences: Array<{ what: string }> }
    const found = list.experiences.find(e => e.what === 'LangChain retry parser test')
    expect(found).toBeDefined()

    // 3. Dashboard network shows updated count
    const networkRes = await app.request('/api/v1/dashboard/network')
    expect(networkRes.status).toBe(200)
    const network = await networkRes.json() as { total_experiences: number }
    expect(network.total_experiences).toBeGreaterThanOrEqual(1)

    // 4. Metrics endpoint shows the agent
    const metricsRes = await app.request('/api/v1/metrics/agents')
    expect(metricsRes.status).toBe(200)
    const metrics = await metricsRes.json() as Array<{ pubkey: string }>
    expect(metrics.length).toBeGreaterThanOrEqual(1)
  })

  it('GET / redirects to /dashboard', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/')
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')
    expect(loc).toContain('/dashboard')
  })

  it('GET /dashboard returns HTML', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/dashboard')
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('text/html')
  })
})
