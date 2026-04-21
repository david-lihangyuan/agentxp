// M5 observational surface: Dashboard, Pulse, Feedback loop, L2 Trace.
// SPEC 01-interfaces §5.3-§5.5; 03-modules-product §7, §8, §9, §12.
import { describe, it, expect } from 'vitest'
import { createEvent, signEvent, delegateAgentKey, generateOperatorKey } from '@agentxp/protocol'
import type { AgentKey, ExperiencePayload } from '@agentxp/protocol'
import {
  bootstrapIdentity,
  fetchJson,
  publish,
  startTestServer,
  type TestServer,
} from './helpers.js'

async function publishExperience(
  srv: TestServer,
  agent: AgentKey,
  overrides: Partial<ExperiencePayload['data']> & {
    tags?: string[]
    reasoning_trace?: unknown
    extendsTarget?: string
  } = {},
): Promise<{ id: string; pubkey: string }> {
  const payload: ExperiencePayload = {
    type: 'experience',
    data: {
      what: overrides.what ?? 'An experience',
      tried: overrides.tried ?? 'Tried the thing',
      outcome: overrides.outcome ?? 'succeeded',
      learned: overrides.learned ?? 'Learned the lesson',
    },
    ...(overrides.reasoning_trace !== undefined
      ? { reasoning_trace: overrides.reasoning_trace }
      : {}),
    ...(overrides.extendsTarget ? { extends: overrides.extendsTarget } : {}),
  }
  const ev = await signEvent(createEvent('intent.broadcast', payload, overrides.tags ?? []), agent)
  const res = await publish(srv, ev)
  if (res.status !== 200) {
    throw new Error(`publish failed ${res.status} ${JSON.stringify(res.body)}`)
  }
  return { id: ev.id, pubkey: ev.pubkey }
}

describe('L2 Reasoning Trace (SPEC §12)', () => {
  it('indexes trace_references and exposes them via GET /experiences/:id/trace', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)

    // First publish a target experience (so a reference resolves).
    const target = await publishExperience(srv, agent, { what: 'Target for reference' })

    const trace = {
      steps: [
        { step_index: 0, action: 'read_file', outcome_short: 'ok', duration_ms: 50 },
        {
          step_index: 1,
          action: 'edit_file',
          outcome_short: 'ok',
          duration_ms: 80,
          references: [target.id, 'f'.repeat(64)],
        },
        { step_index: 2, action: 'bash', outcome_short: 'ok', duration_ms: 30 },
      ],
      trace_summary: '3 steps',
    }
    const pub = await publishExperience(srv, agent, {
      what: 'Trace-bearing experience',
      reasoning_trace: trace,
    })

    const t = await fetchJson<{ references: Array<{ step_index: number; stale: number }> }>(
      srv,
      `/api/v1/experiences/${pub.id}/trace`,
    )
    expect(t.status).toBe(200)
    expect(t.body.references.length).toBe(2)
    const byStep = t.body.references.reduce((a, r) => {
      a[r.step_index] = r
      return a
    }, {} as Record<number, { stale: number }>)
    expect(byStep[1]).toBeDefined()

    // Stale flag: one reference resolved, one unresolved (all-f 64-hex).
    const stales = t.body.references.filter((r) => r.stale === 1)
    expect(stales.length).toBe(1)
  })

  it('rejects a malformed trace with 400 invalid_trace_structure', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'bad trace',
        tried: 'bad trace',
        outcome: 'failed',
        learned: 'n/a',
      },
      reasoning_trace: { steps: 'not an array' } as unknown,
    }
    const ev = await signEvent(createEvent('intent.broadcast', payload, []), agent)
    const res = await publish(srv, ev)
    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toBe('invalid_trace_structure')

    const t = await fetchJson(srv, `/api/v1/experiences/${ev.id}/trace`)
    expect(t.status).toBe(404)
  })
})

describe('Pulse + Feedback loop (SPEC §8, §9)', () => {
  it('search hit writes pulse_events + impact; score reflects it; same-operator yields zero', async () => {
    const srv = startTestServer()
    const { operator: opA, agent: agentA } = await bootstrapIdentity(srv)
    const pub = await publishExperience(srv, agentA, {
      what: 'Searchable Docker tip',
      tags: ['docker'],
    })

    type ScoreBody = { impact_score: number }
    type SearchBody = { results: unknown[] }
    type PulseBody = { pulses: Array<{ kind: string; event_id: string }> }

    // Cold score
    const pre = await fetchJson<ScoreBody>(srv, `/api/v1/experiences/${pub.id}/score`)
    expect(pre.body.impact_score).toBe(0)

    // Same-operator search: no impact.
    const sameOp = await fetchJson<SearchBody>(
      srv,
      `/api/v1/search?q=Docker&viewer_pubkey=${opA.publicKey}`,
    )
    expect(sameOp.body.results.length).toBeGreaterThan(0)
    const midScore = await fetchJson<ScoreBody>(srv, `/api/v1/experiences/${pub.id}/score`)
    expect(midScore.body.impact_score).toBe(0)

    // Cross-operator search: impact increases (§9 acceptance 1).
    const opB = await generateOperatorKey()
    const after = await fetchJson<SearchBody>(
      srv,
      `/api/v1/search?q=Docker&viewer_pubkey=${opB.publicKey}`,
    )
    expect(after.body.results.length).toBeGreaterThan(0)
    const postScore = await fetchJson<ScoreBody>(srv, `/api/v1/experiences/${pub.id}/score`)
    expect(postScore.body.impact_score).toBeGreaterThan(0)

    // Pulse feed shows the search_hit.
    const pulse = await fetchJson<PulseBody>(srv, `/api/v1/pulse`)
    expect(pulse.body.pulses.some((p) => p.kind === 'search_hit' && p.event_id === pub.id)).toBe(
      true,
    )

    // Monotone non-decrease on repeat reads (§9 acceptance 2).
    const second = await fetchJson<ScoreBody>(srv, `/api/v1/experiences/${pub.id}/score`)
    expect(second.body.impact_score).toBeGreaterThanOrEqual(postScore.body.impact_score)
  })

  it('verification-style extends relation writes impact + pulse + relations', async () => {
    const srv = startTestServer()
    const { agent: agentA } = await bootstrapIdentity(srv)
    const target = await publishExperience(srv, agentA, { what: 'Target experience', tags: ['a'] })

    // Second operator publishes an experience that extends the first.
    const opB = await generateOperatorKey()
    const opBasAgent: AgentKey = {
      publicKey: opB.publicKey,
      privateKey: opB.privateKey,
      delegatedBy: opB.publicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 86_400,
      agentId: 'self',
    }
    const regB = await signEvent(
      createEvent(
        'identity.register',
        {
          type: 'operator',
          data: { pubkey: opB.publicKey, registered_at: Math.floor(Date.now() / 1000) },
        },
        [],
      ),
      opBasAgent,
    )
    await publish(srv, regB)
    const agentB = await delegateAgentKey(opB, 'agent-b', 30)
    const delB = await signEvent(
      createEvent(
        'identity.delegate',
        {
          type: 'delegation',
          data: {
            agent_pubkey: agentB.publicKey,
            expires_at: agentB.expiresAt,
            agent_id: agentB.agentId,
          },
        },
        [],
      ),
      opBasAgent,
    )
    await publish(srv, delB)

    await publishExperience(srv, agentB, {
      what: 'Extension of target',
      tags: ['b'],
      extendsTarget: target.id,
    })

    const rels = await fetchJson<{ incoming: Array<{ relation: string }> }>(
      srv,
      `/api/v1/experiences/${target.id}/relations`,
    )
    expect(rels.body.incoming.length).toBe(1)
    expect(rels.body.incoming[0]?.relation).toBe('extends')

    const imp = await fetchJson<{ verifications: number; impact_score: number }>(
      srv,
      `/api/v1/experiences/${target.id}/impact`,
    )
    expect(imp.body.verifications).toBe(1)
    expect(imp.body.impact_score).toBeGreaterThan(0)
  })

  it('POST /pulse/outcome with an unsigned body returns 400 (malformed)', async () => {
    const srv = startTestServer()
    const r = await srv.fetch(
      new Request('http://t/api/v1/pulse/outcome', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: { foo: 'bar' } }),
      }),
    )
    expect(r.status).toBe(400)
  })
})

describe('Dashboard (SPEC §7; MILESTONES M5 checks 1 & 3)', () => {
  it('GET /dashboard serves a read-only HTML page', async () => {
    const srv = startTestServer()
    const r = await srv.fetch(new Request('http://t/dashboard'))
    expect(r.status).toBe(200)
    const body = await r.text()
    expect(body).toContain('<title>AgentXP Dashboard</title>')
    expect(body).toContain('/dashboard/network')
    expect(body).toContain('/dashboard/experiences')
  })

  it('POST to /dashboard returns 404/405 (UI is verified read-only)', async () => {
    const srv = startTestServer()
    const r = await srv.fetch(new Request('http://t/dashboard', { method: 'POST' }))
    expect([404, 405]).toContain(r.status)
  })

  it('GET /dashboard/operator/:pubkey/summary returns real counts', async () => {
    const srv = startTestServer()
    const { operator, agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, { what: 'One', outcome: 'succeeded' })
    await publishExperience(srv, agent, { what: 'Two', outcome: 'failed' })
    const s = await fetchJson<{
      experiences: number
      succeeded: number
      failed: number
      agents: number
    }>(srv, `/api/v1/dashboard/operator/${operator.publicKey}/summary`)
    expect(s.status).toBe(200)
    expect(s.body.experiences).toBe(2)
    expect(s.body.succeeded).toBe(1)
    expect(s.body.failed).toBe(1)
    expect(s.body.agents).toBe(1)
  })

  it('unknown operator returns 404 with a JSON error body (§7 acceptance 2)', async () => {
    const srv = startTestServer()
    const s = await fetchJson<{ error: string }>(
      srv,
      `/api/v1/dashboard/operator/${'a'.repeat(64)}/summary`,
    )
    expect(s.status).toBe(404)
    expect(s.body.error).toBe('not_found')
  })

  it('GET /dashboard/experiences + /dashboard/network render recent content', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, { what: 'Recent one' })
    const exp = await fetchJson<{ experiences: unknown[] }>(srv, `/api/v1/dashboard/experiences`)
    expect(exp.body.experiences.length).toBe(1)
    const net = await fetchJson<{ operators: number; experiences: number }>(
      srv,
      `/api/v1/dashboard/network`,
    )
    expect(net.body.operators).toBeGreaterThanOrEqual(1)
    expect(net.body.experiences).toBe(1)
  })

  it('GET /dashboard/operator/:pubkey/growth returns 400 for a non-hex pubkey', async () => {
    const srv = startTestServer()
    const res = await fetchJson(srv, '/api/v1/dashboard/operator/not-hex/growth')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_pubkey' })
  })

  it('GET /dashboard/operator/:pubkey/growth returns empty buckets for an unknown operator', async () => {
    const srv = startTestServer()
    const res = await fetchJson(srv, `/api/v1/dashboard/operator/${'b'.repeat(64)}/growth`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ buckets: [] })
  })

  it('GET /dashboard/operator/:pubkey/growth buckets published experiences by day', async () => {
    const srv = startTestServer()
    const { operator, agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, { what: 'One' })
    await publishExperience(srv, agent, { what: 'Two' })

    const res = await fetchJson<{ buckets: Array<{ day_bucket: number; count: number }> }>(
      srv,
      `/api/v1/dashboard/operator/${operator.publicKey}/growth`,
    )
    expect(res.status).toBe(200)
    const buckets = res.body.buckets
    expect(buckets.length).toBe(1) // both publishes land in the same second, same day bucket
    expect(buckets[0]?.count).toBe(2)
    expect(typeof buckets[0]?.day_bucket).toBe('number')
  })

  it('GET /dashboard/operator/:pubkey/failures returns 400 for a non-hex pubkey', async () => {
    const srv = startTestServer()
    const res = await fetchJson(srv, '/api/v1/dashboard/operator/not-hex/failures')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_pubkey' })
  })

  it('GET /dashboard/operator/:pubkey/failures lists only failed/partial/inconclusive experiences', async () => {
    const srv = startTestServer()
    const { operator, agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, { what: 'Happy path', outcome: 'succeeded' })
    await publishExperience(srv, agent, { what: 'Broke something', outcome: 'failed' })
    await publishExperience(srv, agent, { what: 'Sort of', outcome: 'partial' })

    const res = await fetchJson<{ failures: Array<{ what: string; outcome: string }> }>(
      srv,
      `/api/v1/dashboard/operator/${operator.publicKey}/failures`,
    )
    expect(res.status).toBe(200)
    const failures = res.body.failures
    expect(failures.length).toBe(2)
    const outcomes = new Set(failures.map((f) => f.outcome))
    expect(outcomes).toEqual(new Set(['failed', 'partial']))
  })

  it('GET /dashboard/operator/:pubkey/failures respects limit=<n>', async () => {
    const srv = startTestServer()
    const { operator, agent } = await bootstrapIdentity(srv)
    await publishExperience(srv, agent, { what: 'f1', outcome: 'failed' })
    await publishExperience(srv, agent, { what: 'f2', outcome: 'failed' })
    await publishExperience(srv, agent, { what: 'f3', outcome: 'failed' })

    const res = await fetchJson<{ failures: unknown[] }>(
      srv,
      `/api/v1/dashboard/operator/${operator.publicKey}/failures?limit=2`,
    )
    expect(res.status).toBe(200)
    expect(res.body.failures.length).toBe(2)
  })
})

describe('POST /api/v1/experiences/:id/relations (SPEC \u00a75.4)', () => {
  it('returns 400 for a non-hex id', async () => {
    const srv = startTestServer()
    const r = await srv.fetch(
      new Request('http://t/api/v1/experiences/not-hex/relations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'invalid_id' })
  })

  it('returns 400 for a malformed body (missing event envelope)', async () => {
    const srv = startTestServer()
    const r = await srv.fetch(
      new Request(`http://t/api/v1/experiences/${'a'.repeat(64)}/relations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: { foo: 'bar' } }),
      }),
    )
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'malformed_event' })
  })

  it('accepts a signed extends-style experience and records the relation', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    const target = await publishExperience(srv, agent, { what: 'Target' })

    // Build a signed experience that `extends` the target, then POST it to
    // the relation endpoint instead of /events. SPEC §5.4 allows relation
    // submission through either route; this test characterizes that
    // /experiences/:id/relations shares the same ingest pipeline.
    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'Extending target',
        tried: 't',
        outcome: 'succeeded',
        learned: 'l',
      },
      extends: target.id,
    }
    const signed = await signEvent(createEvent('intent.broadcast', payload, []), agent)
    const r = await srv.fetch(
      new Request(`http://t/api/v1/experiences/${target.id}/relations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: signed }),
      }),
    )
    expect(r.status).toBe(200)
    const body = (await r.json()) as { accepted: boolean; event_id: string }
    expect(body.accepted).toBe(true)
    expect(body.event_id).toBe(signed.id)

    // Verify the relation actually landed in experience_relations.
    const rels = await fetchJson<{ incoming: Array<{ relation: string }> }>(
      srv,
      `/api/v1/experiences/${target.id}/relations`,
    )
    expect(rels.body.incoming.length).toBe(1)
    expect(rels.body.incoming[0]?.relation).toBe('extends')
  })
})
