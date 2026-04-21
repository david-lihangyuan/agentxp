// Characterization tests for GET /api/v1/metrics/* (SPEC 01-interfaces §5.5).
// Freezes current observable behavior so we can safely refactor the
// route out of app.ts into routes/metrics.ts.
import { describe, it, expect } from 'vitest'
import { createEvent, signEvent } from '@agentxp/protocol'
import type { AgentKey, ExperiencePayload } from '@agentxp/protocol'
import { bootstrapIdentity, publish, startTestServer, type TestServer } from './helpers.js'

async function publishExperience(
  srv: TestServer,
  agent: AgentKey,
  what: string,
): Promise<string> {
  const payload: ExperiencePayload = {
    type: 'experience',
    data: { what, tried: 't', outcome: 'succeeded', learned: 'l' },
  }
  const ev = await signEvent(createEvent('intent.broadcast', payload, []), agent)
  const res = await publish(srv, ev)
  if (res.status !== 200) {
    throw new Error(`publish failed ${res.status} ${JSON.stringify(res.body)}`)
  }
  return ev.id
}

async function fetchJson(srv: TestServer, path: string): Promise<{ status: number; body: any }> {
  const r = await srv.fetch(new Request(`http://t${path}`))
  return { status: r.status, body: await r.json() }
}

describe('GET /api/v1/metrics/agents (SPEC §5.5)', () => {
  it('returns an empty list for a fresh server', async () => {
    const srv = startTestServer()
    const res = await fetchJson(srv, '/api/v1/metrics/agents')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ agents: [] })
  })

  it('lists a registered agent with its experience count', async () => {
    const srv = startTestServer()
    const { operator, agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, 'one')
    await publishExperience(srv, agent, 'two')

    const res = await fetchJson(srv, '/api/v1/metrics/agents')
    expect(res.status).toBe(200)
    const agents = res.body.agents as Array<{
      pubkey: string
      operator_pubkey: string | null
      agent_id: string | null
      experiences: number
    }>
    expect(agents.length).toBe(1)
    expect(agents[0]?.pubkey).toBe(agent.publicKey)
    expect(agents[0]?.operator_pubkey).toBe(operator.publicKey)
    expect(agents[0]?.experiences).toBe(2)
  })

  it('respects limit=<n>', async () => {
    const srv = startTestServer()
    const { agent: a1 } = await bootstrapIdentity(srv)
    const { agent: a2 } = await bootstrapIdentity(srv)
    // Guarantee a2 ranks above a1 by experience count.
    await publishExperience(srv, a1, 'a1 exp 1')
    await publishExperience(srv, a2, 'a2 exp 1')
    await publishExperience(srv, a2, 'a2 exp 2')

    const res = await fetchJson(srv, '/api/v1/metrics/agents?limit=1')
    expect(res.status).toBe(200)
    expect(res.body.agents.length).toBe(1)
    expect(res.body.agents[0]?.pubkey).toBe(a2.publicKey)
  })

  it('clamps limit=0 up to 1', async () => {
    const srv = startTestServer()
    await bootstrapIdentity(srv)
    await bootstrapIdentity(srv)
    const res = await fetchJson(srv, '/api/v1/metrics/agents?limit=0')
    expect(res.status).toBe(200)
    expect(res.body.agents.length).toBe(1)
  })

  it('falls back to the default when limit is not a number', async () => {
    const srv = startTestServer()
    await bootstrapIdentity(srv)
    await bootstrapIdentity(srv)
    const res = await fetchJson(srv, '/api/v1/metrics/agents?limit=abc')
    expect(res.status).toBe(200)
    expect(res.body.agents.length).toBe(2)
  })
})

describe('GET /api/v1/metrics/agent/:pubkey (SPEC §5.5)', () => {
  it('returns the metric row for a known agent pubkey', async () => {
    const srv = startTestServer()
    const { operator, agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, 'only one')

    const res = await fetchJson(srv, `/api/v1/metrics/agent/${agent.publicKey}`)
    expect(res.status).toBe(200)
    expect(res.body.pubkey).toBe(agent.publicKey)
    expect(res.body.operator_pubkey).toBe(operator.publicKey)
    expect(res.body.experiences).toBe(1)
    expect(typeof res.body.last_activity).toBe('number')
  })

  it('returns 400 for a non-hex pubkey', async () => {
    const srv = startTestServer()
    const res = await fetchJson(srv, '/api/v1/metrics/agent/not-a-hex-pubkey')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_pubkey' })
  })

  it('returns 400 for a hex string of the wrong length', async () => {
    const srv = startTestServer()
    // 63 hex chars — one short of the required 64.
    const short = 'a'.repeat(63)
    const res = await fetchJson(srv, `/api/v1/metrics/agent/${short}`)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_pubkey' })
  })

  it('returns 404 for a well-formed but unknown pubkey', async () => {
    const srv = startTestServer()
    const unknown = 'f'.repeat(64)
    const res = await fetchJson(srv, `/api/v1/metrics/agent/${unknown}`)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not_found' })
  })
})
