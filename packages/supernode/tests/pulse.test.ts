// Characterization tests for GET /api/v1/pulse (SPEC 01-interfaces §5.3).
// Freezes current observable behavior so we can safely refactor the
// route out of app.ts into routes/pulse.ts.
import { describe, it, expect } from 'vitest'
import { createEvent, generateOperatorKey, signEvent } from '@agentxp/protocol'
import type { AgentKey, ExperiencePayload } from '@agentxp/protocol'
import {
  bootstrapIdentity,
  fetchJson,
  publish,
  startTestServer,
  type TestServer,
} from './helpers.js'

interface PulseEntry {
  event_id: string
  kind: string
  created_at: number
}
interface PulseResponse {
  pulses: PulseEntry[]
  next_cursor: string | null
}

async function publishExperience(
  srv: TestServer,
  agent: AgentKey,
  what: string,
  tags: string[],
): Promise<string> {
  const payload: ExperiencePayload = {
    type: 'experience',
    data: { what, tried: 't', outcome: 'succeeded', learned: 'l' },
  }
  const ev = await signEvent(createEvent('intent.broadcast', payload, tags), agent)
  const res = await publish(srv, ev)
  if (res.status !== 200) {
    throw new Error(`publish failed ${res.status} ${JSON.stringify(res.body)}`)
  }
  return ev.id
}

// Drive at least one pulse_event row via cross-operator search.
// Same-operator searches do NOT write pulses (SPEC §9 acceptance 1),
// so we create an independent viewer key each time we want a hit.
async function triggerPulse(srv: TestServer, q: string): Promise<void> {
  const viewer = await generateOperatorKey()
  const r = await srv.fetch(
    new Request(`http://t/api/v1/search?q=${encodeURIComponent(q)}&viewer_pubkey=${viewer.publicKey}`),
  )
  if (r.status !== 200) {
    throw new Error(`search failed: ${r.status}`)
  }
}

describe('GET /api/v1/pulse — observational feed (SPEC §5.3)', () => {
  it('returns an empty envelope when no pulse_events exist', async () => {
    const srv = startTestServer()
    const res = await fetchJson(srv, '/api/v1/pulse')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ pulses: [], next_cursor: null })
  })

  it('returns pulse rows in recency order (newest first)', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    const id1 = await publishExperience(srv, agent, 'alpha topic', ['alpha'])
    const id2 = await publishExperience(srv, agent, 'beta topic', ['beta'])
    await triggerPulse(srv, 'alpha')
    await triggerPulse(srv, 'beta')

    const res = await fetchJson<PulseResponse>(srv, '/api/v1/pulse')
    expect(res.status).toBe(200)
    const pulses = res.body.pulses
    expect(pulses.length).toBeGreaterThanOrEqual(2)
    // created_at is non-increasing.
    for (let i = 1; i < pulses.length; i += 1) {
      const prev = pulses[i - 1]?.created_at ?? 0
      const cur = pulses[i]?.created_at ?? 0
      expect(prev).toBeGreaterThanOrEqual(cur)
    }
    const ids = pulses.map((p) => p.event_id)
    expect(ids).toContain(id1)
    expect(ids).toContain(id2)
    // Only search_hit pulses are produced in this scenario.
    expect(pulses.every((p) => p.kind === 'search_hit')).toBe(true)
    expect(res.body.next_cursor).toBeNull()
  })

  it('respects limit=<n> when within range', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, 'one', ['x'])
    await publishExperience(srv, agent, 'two', ['y'])
    await publishExperience(srv, agent, 'three', ['z'])
    await triggerPulse(srv, 'one')
    await triggerPulse(srv, 'two')
    await triggerPulse(srv, 'three')

    const res = await fetchJson<PulseResponse>(srv, '/api/v1/pulse?limit=2')
    expect(res.status).toBe(200)
    expect(res.body.pulses.length).toBe(2)
  })

  it('clamps limit=0 up to 1', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, 'one', ['x'])
    await publishExperience(srv, agent, 'two', ['y'])
    await triggerPulse(srv, 'one')
    await triggerPulse(srv, 'two')

    const res = await fetchJson<PulseResponse>(srv, '/api/v1/pulse?limit=0')
    expect(res.status).toBe(200)
    expect(res.body.pulses.length).toBe(1)
  })

  it('clamps negative limit up to 1', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, 'one', ['x'])
    await publishExperience(srv, agent, 'two', ['y'])
    await triggerPulse(srv, 'one')
    await triggerPulse(srv, 'two')

    const res = await fetchJson<PulseResponse>(srv, '/api/v1/pulse?limit=-5')
    expect(res.status).toBe(200)
    expect(res.body.pulses.length).toBe(1)
  })

  it('falls back to the default when limit is not a number', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    // Produce 3 pulse rows (well under the default of 50).
    await publishExperience(srv, agent, 'one', ['x'])
    await publishExperience(srv, agent, 'two', ['y'])
    await publishExperience(srv, agent, 'three', ['z'])
    await triggerPulse(srv, 'one')
    await triggerPulse(srv, 'two')
    await triggerPulse(srv, 'three')

    const res = await fetchJson<PulseResponse>(srv, '/api/v1/pulse?limit=abc')
    expect(res.status).toBe(200)
    expect(res.body.pulses.length).toBe(3)
  })
})
