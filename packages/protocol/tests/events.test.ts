import { createHash } from 'node:crypto'
import { beforeAll, describe, it, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519'
import { canonicalize } from '../src/canonical.js'
import { InvalidKindError, PayloadTooLargeError } from '../src/errors.js'
import { createEvent, signEvent, verifyEvent, MAX_PAYLOAD_BYTES } from '../src/events.js'
import { delegateAgentKey, generateOperatorKey } from '../src/keys.js'
import type { AgentKey, ExperiencePayload, OperatorKey, SerendipEvent } from '../src/types.js'

const baseExperience: ExperiencePayload = {
  type: 'experience',
  data: {
    what: 'Docker DNS fix',
    tried: 'modified /etc/resolv.conf inside the container',
    outcome: 'succeeded',
    learned: 'Docker DNS cache clears on container restart.',
  },
}

let operator: OperatorKey
let agent: AgentKey

beforeAll(async () => {
  operator = await generateOperatorKey()
  agent = await delegateAgentKey(operator, 'tests', 30)
})

describe('createEvent (Phase A §A3)', () => {
  it('builds an unsigned envelope with v:1 and defaults', () => {
    const ev = createEvent('intent.broadcast', baseExperience, ['docker'])
    expect(ev.v).toBe(1)
    expect(ev.kind).toBe('intent.broadcast')
    expect(ev.tags).toEqual(['docker'])
    expect(ev.visibility).toBe('public')
    expect(ev.created_at).toBeGreaterThan(0)
  })

  it('rejects an unknown kind at runtime (InvalidKindError)', () => {
    expect(() =>
      // Forcing an invalid value to verify runtime guard; typed as never per SPEC 02-data-model §2.
      createEvent('experience.publish' as never, baseExperience, []),
    ).toThrow(InvalidKindError)
  })
})

describe('signEvent (Phase A §A3; 03-modules-platform §1)', () => {
  it('happy path: produces an id matching an independent SHA-256 of canonical bytes', async () => {
    const unsigned = createEvent('intent.broadcast', baseExperience, ['x'])
    const withKeys = { ...unsigned, pubkey: agent.publicKey, operator_pubkey: agent.delegatedBy }
    const expectedId = createHash('sha256').update(canonicalize(withKeys), 'utf8').digest('hex')
    const signed = await signEvent(unsigned, agent)
    expect(signed.id).toBe(expectedId)
    expect(signed.sig).toHaveLength(128)
    expect(signed.pubkey).toBe(agent.publicKey)
    expect(signed.operator_pubkey).toBe(agent.delegatedBy)
  })

  it('round-trips: verifyEvent returns true for a freshly signed event', async () => {
    const unsigned = createEvent('intent.broadcast', baseExperience, [])
    const signed = await signEvent(unsigned, agent)
    expect(await verifyEvent(signed)).toBe(true)
  })

  it('accepts a payload at exactly MAX_PAYLOAD_BYTES', async () => {
    const filler = 'a'.repeat(MAX_PAYLOAD_BYTES - JSON.stringify({ type: 'raw', data: '' }).length)
    const payload = { type: 'raw', data: filler }
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBe(MAX_PAYLOAD_BYTES)
    const unsigned = createEvent('intent.broadcast', payload, [])
    await expect(signEvent(unsigned, agent)).resolves.toBeDefined()
  })

  it('rejects a payload at MAX_PAYLOAD_BYTES + 1 with PayloadTooLargeError', async () => {
    const filler = 'a'.repeat(
      MAX_PAYLOAD_BYTES - JSON.stringify({ type: 'raw', data: '' }).length + 1,
    )
    const payload = { type: 'raw', data: filler }
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBe(MAX_PAYLOAD_BYTES + 1)
    const unsigned = createEvent('intent.broadcast', payload, [])
    await expect(signEvent(unsigned, agent)).rejects.toBeInstanceOf(PayloadTooLargeError)
  })

  it('rejects an unknown kind (defence in depth against bypass of createEvent)', async () => {
    const unsigned = createEvent('intent.broadcast', baseExperience, [])
    const bypassed = { ...unsigned, kind: 'experience.publish' as never }
    await expect(signEvent(bypassed, agent)).rejects.toBeInstanceOf(InvalidKindError)
  })
})

describe('verifyEvent (Phase A §A3; 03-modules-platform §1 acceptance 3)', () => {
  it('returns false when payload is tampered post-sign', async () => {
    const signed = await signEvent(createEvent('intent.broadcast', baseExperience, []), agent)
    const tampered: SerendipEvent = {
      ...signed,
      payload: { type: 'experience', data: { ...baseExperience.data, what: 'tampered' } },
    }
    expect(await verifyEvent(tampered)).toBe(false)
  })

  it('returns false when id is tampered', async () => {
    const signed = await signEvent(createEvent('intent.broadcast', baseExperience, []), agent)
    expect(await verifyEvent({ ...signed, id: 'f'.repeat(64) })).toBe(false)
  })

  it('returns false when sig is a valid Ed25519 signature under a different key', async () => {
    const signed = await signEvent(createEvent('intent.broadcast', baseExperience, []), agent)
    const other = await generateOperatorKey()
    const wrongSig = Buffer.from(
      ed25519.sign(Buffer.from(signed.id, 'hex'), other.privateKey),
    ).toString('hex')
    expect(await verifyEvent({ ...signed, sig: wrongSig })).toBe(false)
  })

  it('does not throw on structurally invalid inputs', async () => {
    const bad = { ...(await signEvent(createEvent('intent.broadcast', baseExperience, []), agent)) }
    bad.sig = 'zz' // non-hex
    await expect(verifyEvent(bad)).resolves.toBe(false)
  })
})
