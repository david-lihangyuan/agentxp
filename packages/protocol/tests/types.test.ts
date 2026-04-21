import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  AgentKey,
  ExperienceData,
  ExperiencePayload,
  ExperienceScope,
  IdentityKind,
  IntentKind,
  IntentPayload,
  OperatorKey,
  SerendipEvent,
  SerendipKind,
} from '../src/types.js'

describe('SerendipEvent envelope (SPEC 02-data-model §1)', () => {
  it('accepts a fully-populated envelope with the normative fields', () => {
    const event: SerendipEvent = {
      v: 1,
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: 1775867000,
      kind: 'intent.broadcast',
      payload: { type: 'experience', data: {} },
      tags: [],
      visibility: 'public',
      operator_pubkey: 'c'.repeat(64),
      sig: 'd'.repeat(128),
    }
    expect(event.v).toBe(1)
    expect(event.visibility).toBe('public')
  })

  it('enumerates protocol-layer kinds only (no application kinds leak in)', () => {
    expectTypeOf<IntentKind>().toEqualTypeOf<
      'intent.broadcast' | 'intent.match' | 'intent.verify' | 'intent.subscribe'
    >()
    expectTypeOf<IdentityKind>().toEqualTypeOf<
      'identity.register' | 'identity.delegate' | 'identity.revoke'
    >()
    expectTypeOf<SerendipKind>().toEqualTypeOf<IntentKind | IdentityKind>()
  })
})

describe('ExperiencePayload (SPEC 02-data-model §3)', () => {
  it('extends IntentPayload with experience-specific data', () => {
    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'Docker DNS fix',
        tried: 'modified /etc/resolv.conf',
        outcome: 'succeeded',
        learned: 'restart container to clear DNS cache',
      },
    }
    expectTypeOf(payload).toMatchTypeOf<IntentPayload>()
    expect(payload.type).toBe('experience')
    expect(payload.data.outcome).toBe('succeeded')
  })

  it('constrains outcome to the four SPEC literals', () => {
    expectTypeOf<ExperienceData['outcome']>().toEqualTypeOf<
      'succeeded' | 'failed' | 'partial' | 'inconclusive'
    >()
  })

  it('treats scope and its inner fields as optional', () => {
    const withoutScope: ExperienceData = {
      what: 'x',
      tried: 'y',
      outcome: 'partial',
      learned: 'z',
    }
    const withScope: ExperienceData = {
      ...withoutScope,
      scope: { versions: ['bun>=1.0'], platforms: ['linux'], context: 'ci' },
    }
    expect(withoutScope.scope).toBeUndefined()
    expect(withScope.scope?.platforms).toEqual(['linux'])
    expectTypeOf<ExperienceScope>().toMatchTypeOf<{
      versions?: string[]
      platforms?: string[]
      context?: string
    }>()
  })
})

describe('Identity keys (Phase A §A1)', () => {
  it('models OperatorKey and AgentKey as distinct shapes', () => {
    const opKey: OperatorKey = {
      publicKey: 'a'.repeat(64),
      privateKey: new Uint8Array(32),
    }
    const agentKey: AgentKey = {
      publicKey: 'b'.repeat(64),
      privateKey: new Uint8Array(32),
      delegatedBy: opKey.publicKey,
      expiresAt: 1_900_000_000,
    }
    expect(agentKey.delegatedBy).toBe(opKey.publicKey)
  })
})
