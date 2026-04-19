import { describe, it, expect } from 'vitest'
import type {
  SerendipEvent,
  IntentKind,
  IdentityKind,
  SerendipKind,
  IntentPayload,
  ExperiencePayload,
  ExperienceScope,
  OperatorKey,
  AgentKey,
} from '../src/types'

describe('A1: Type Definitions', () => {
  it('Test 1: SerendipEvent has required fields including version=1', () => {
    const event: SerendipEvent = {
      v: 1,
      id: 'abc123' + 'a'.repeat(58),
      pubkey: 'deadbeef'.repeat(8),
      created_at: 1775867000,
      kind: 'intent.broadcast',
      payload: { type: 'experience', data: {} },
      tags: [],
      visibility: 'public',
      operator_pubkey: 'deadbeef'.repeat(8),
      sig: 'abc'.repeat(42) + 'ab',
    }
    expect(event.v).toBe(1)
    expect(event.kind).toBe('intent.broadcast')
  })

  it('Test 2: IntentKind includes all protocol-layer intent kinds', () => {
    const kinds: IntentKind[] = [
      'intent.broadcast',
      'intent.match',
      'intent.verify',
      'intent.subscribe',
    ]
    expect(kinds).toHaveLength(4)
  })

  it('Test 3: IdentityKind includes all identity kinds', () => {
    const kinds: IdentityKind[] = [
      'identity.register',
      'identity.delegate',
      'identity.revoke',
    ]
    expect(kinds).toHaveLength(3)
  })

  it('Test 4: SerendipKind is union of IntentKind and IdentityKind', () => {
    const k1: SerendipKind = 'intent.broadcast'
    const k2: SerendipKind = 'identity.revoke'
    expect(k1).toBe('intent.broadcast')
    expect(k2).toBe('identity.revoke')
  })

  it('Test 5: ExperiencePayload is application-layer, extends IntentPayload', () => {
    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'Docker DNS fix',
        tried: 'modified /etc/resolv.conf',
        outcome: 'succeeded',
        learned: 'restart container to clear DNS cache',
      },
    }
    expect(payload.type).toBe('experience')
    expect(payload.data.outcome).toBe('succeeded')
  })

  it('Test 6: OperatorKey and AgentKey are distinct types', () => {
    const opKey: OperatorKey = {
      publicKey: 'a'.repeat(64),
      privateKey: new Uint8Array(32),
    }
    const agentKey: AgentKey = {
      publicKey: 'b'.repeat(64),
      privateKey: new Uint8Array(32),
      delegatedBy: 'a'.repeat(64),
      expiresAt: Math.floor(Date.now() / 1000) + 90 * 86400,
    }
    expect(agentKey.delegatedBy).toBe(opKey.publicKey)
    expect(agentKey.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('Test 7: ExperienceScope is optional, structured', () => {
    const scope: ExperienceScope = {
      versions: ['docker>=24', 'bun>=1.0'],
      platforms: ['linux', 'macos'],
      context: 'production',
    }
    expect(scope.versions).toHaveLength(2)
    expect(scope.platforms).toContain('linux')
    expect(scope.context).toBe('production')
  })

  it('Test 8: ExperiencePayload with scope is valid', () => {
    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'Docker DNS fix',
        tried: 'modified /etc/resolv.conf',
        outcome: 'succeeded',
        learned: 'restart container to clear DNS cache',
        scope: {
          versions: ['docker>=24'],
          platforms: ['linux'],
        },
      },
    }
    expect(payload.data.scope?.versions).toContain('docker>=24')
  })

  it('Test 9: ExperienceData outcome values are constrained', () => {
    const outcomes: Array<'succeeded' | 'failed' | 'partial' | 'inconclusive'> = [
      'succeeded',
      'failed',
      'partial',
      'inconclusive',
    ]
    expect(outcomes).toHaveLength(4)
  })

  it('Test 10: SerendipEvent visibility is constrained to public or private', () => {
    const pub: SerendipEvent['visibility'] = 'public'
    const priv: SerendipEvent['visibility'] = 'private'
    expect(pub).toBe('public')
    expect(priv).toBe('private')
  })
})
