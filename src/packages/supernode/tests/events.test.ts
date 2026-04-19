import { describe, it, expect } from 'vitest'
import { createEvent, signEvent } from '@serendip/protocol'
import type { ExperiencePayload } from '@serendip/protocol'
import { bootstrapIdentity, publish, startTestServer } from './helpers.js'

const experience: ExperiencePayload = {
  type: 'experience',
  data: {
    what: 'Docker DNS cache cleared',
    tried: 'Restarted the container so resolv.conf reloads',
    outcome: 'succeeded',
    learned: 'Container restart is enough; daemon restart not needed',
  },
}

describe('POST /api/v1/events (SPEC 01-interfaces §5.1; MILESTONES M2 check 2/3)', () => {
  it('accepts a valid signed experience and echoes it via GET /events/:id', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)

    const signed = await signEvent(createEvent('intent.broadcast', experience, ['docker']), agent)
    const res = await publish(srv, signed)

    expect(res.status).toBe(200)
    const body = res.body as { accepted: boolean; event_id: string; received_at: number }
    expect(body.accepted).toBe(true)
    expect(body.event_id).toBe(signed.id)

    const get = await srv.fetch(new Request(`http://t/api/v1/events/${signed.id}`))
    expect(get.status).toBe(200)
    const getBody = (await get.json()) as { event: { id: string } }
    expect(getBody.event.id).toBe(signed.id)
  })

  it('is idempotent by event.id (SPEC §2 contract + acceptance 2)', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    const signed = await signEvent(createEvent('intent.broadcast', experience, []), agent)

    const first = await publish(srv, signed)
    const second = await publish(srv, signed)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const list = await srv.fetch(new Request('http://t/api/v1/experiences'))
    const listBody = (await list.json()) as { experiences: unknown[] }
    expect(listBody.experiences.length).toBe(1)
  })

  it('returns 401 when signature does not verify (MILESTONES M2 check 4)', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    const signed = await signEvent(createEvent('intent.broadcast', experience, []), agent)
    const tampered = {
      ...signed,
      payload: { ...signed.payload, data: { ...experience.data, what: 'tampered' } },
    }

    const res = await publish(srv, tampered)
    expect(res.status).toBe(401)
    expect((res.body as { error: string }).error).toBe('signature_invalid')
  })

  it('returns 400 when ExperienceData.what is empty (SPEC §2 contract)', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    const bad: ExperiencePayload = {
      type: 'experience',
      data: { ...experience.data, what: '' },
    }
    const signed = await signEvent(createEvent('intent.broadcast', bad, []), agent)

    const res = await publish(srv, signed)
    expect(res.status).toBe(400)
    expect((res.body as { field: string }).field).toBe('data.what')
  })

  it('returns 403 when the delegating operator has revoked the agent (SPEC §2 acceptance 3)', async () => {
    const srv = startTestServer()
    const { operator, agent } = await bootstrapIdentity(srv)
    const operatorAsAgent = {
      publicKey: operator.publicKey,
      privateKey: operator.privateKey,
      delegatedBy: operator.publicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 86_400,
      agentId: 'self',
    }
    const revoke = await signEvent(
      createEvent(
        'identity.revoke',
        { type: 'revocation', data: { agent_pubkey: agent.publicKey } },
        [],
      ),
      operatorAsAgent,
    )
    expect((await publish(srv, revoke)).status).toBe(200)

    const signed = await signEvent(createEvent('intent.broadcast', experience, []), agent)
    const res = await publish(srv, signed)
    expect(res.status).toBe(403)
    expect((res.body as { error: string }).error).toBe('delegation_revoked')
  })
})

describe('GET /api/v1/search (SPEC 01-interfaces §5.1; MILESTONES M2 check 3)', () => {
  it('echoes a published experience back through keyword search', async () => {
    const srv = startTestServer()
    const { agent } = await bootstrapIdentity(srv)
    const signed = await signEvent(createEvent('intent.broadcast', experience, ['docker']), agent)
    expect((await publish(srv, signed)).status).toBe(200)

    const res = await srv.fetch(new Request('http://t/api/v1/search?q=docker'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      results: Array<{ event_id: string; score: number }>
    }
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results[0]?.event_id).toBe(signed.id)
    expect(body.results[0]?.score).toBeGreaterThan(0)
  })

  it('returns 400 without q', async () => {
    const srv = startTestServer()
    const res = await srv.fetch(new Request('http://t/api/v1/search'))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/identities/:pubkey (SPEC 01-interfaces §5.2)', () => {
  it('returns the agent with delegated_by pointing to the operator', async () => {
    const srv = startTestServer()
    const { operator, agent } = await bootstrapIdentity(srv)
    const res = await srv.fetch(new Request(`http://t/api/v1/identities/${agent.publicKey}`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { kind: string; operator_pubkey: string; revoked: boolean }
    expect(body.kind).toBe('agent')
    expect(body.operator_pubkey).toBe(operator.publicKey)
    expect(body.revoked).toBe(false)
  })

  it('returns 404 for an unknown pubkey', async () => {
    const srv = startTestServer()
    const res = await srv.fetch(new Request(`http://t/api/v1/identities/${'0'.repeat(64)}`))
    expect(res.status).toBe(404)
  })
})

describe('GET /health (SPEC 01-interfaces §5.6; MILESTONES M2 check 1)', () => {
  it('returns 200 with status ok', async () => {
    const srv = startTestServer()
    const res = await srv.fetch(new Request('http://t/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok' })
  })
})
