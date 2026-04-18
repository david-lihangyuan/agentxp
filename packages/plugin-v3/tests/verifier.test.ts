import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as ed from '@noble/ed25519'
import { createDb, type Db } from '../db'
import { publishVerifications, aggregateOutcome, type VerifierConfig } from '../service/verifier'

async function makeKeys(): Promise<{ privHex: string; pubHex: string }> {
  const priv = ed.utils.randomSecretKey()
  const pub = await ed.getPublicKeyAsync(priv)
  return {
    privHex: Buffer.from(priv).toString('hex'),
    pubHex: Buffer.from(pub).toString('hex'),
  }
}

function seedNetworkExperience(db: Db, relayEventId: string): number {
  const r = db.db
    .prepare(
      `INSERT INTO network_experiences (
         relay_event_id, pubkey, category, title, tried, outcome, learned,
         tags, scope, trust_score, pulse_state, last_verified_at, created_at, pulled_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(relayEventId, 'x'.repeat(64), 'lesson', 't', 'tr', 'ok', 'l', '[]', '{}', 0.5, 'discovered', null, 0, 0)
  return Number(r.lastInsertRowid)
}

function seedInjection(db: Db, sessionId: string, sourceIds: number[], createdAt: number): void {
  db.db
    .prepare(
      `INSERT INTO injection_log (
         session_id, injected, token_count, source_ids, source_type, created_at
       ) VALUES (?, 1, 0, ?, 'network', ?)`,
    )
    .run(sessionId, JSON.stringify(sourceIds), createdAt)
}

function seedReflection(db: Db, sessionId: string, outcome: string, createdAt: number): void {
  db.db
    .prepare(
      `INSERT INTO reflections (
         session_id, source_file, category, title, tried, expected, outcome, learned,
         why_wrong, tags, quality_score, published, relay_event_id, visibility, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, null, 'lesson', 't', 'tr', null, outcome, 'l', null, '[]', 0.9, 0, null, 'public', createdAt, createdAt)
}

describe('aggregateOutcome', () => {
  it('maps succeeded -> confirmed', () => {
    expect(aggregateOutcome(['succeeded'])).toBe('confirmed')
    expect(aggregateOutcome(['failed', 'succeeded'])).toBe('confirmed')
  })
  it('maps all-failed -> refuted', () => {
    expect(aggregateOutcome(['failed'])).toBe('refuted')
    expect(aggregateOutcome(['failed', 'failed'])).toBe('refuted')
  })
  it('maps mixed without succeeded -> partial', () => {
    expect(aggregateOutcome(['partial'])).toBe('partial')
    expect(aggregateOutcome(['failed', 'partial'])).toBe('partial')
  })
  it('returns null on empty', () => {
    expect(aggregateOutcome([])).toBeNull()
  })
})

describe('publishVerifications: outbound verification events', () => {
  let db: Db
  let cfg: VerifierConfig

  beforeEach(async () => {
    db = createDb(':memory:')
    const { privHex, pubHex } = await makeKeys()
    cfg = { relayUrl: 'http://r', operatorPubkey: pubHex, agentKey: privHex }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.db.close()
  })

  it('signs and posts a confirmed verification when a session succeeds', async () => {
    const target = 'd'.repeat(64)
    const netId = seedNetworkExperience(db, target)
    seedInjection(db, 's1', [netId], 100)
    seedReflection(db, 's1', 'succeeded', 200)

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await publishVerifications(db, cfg)

    expect(r.published).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://r/api/v1/events')
    const body = JSON.parse(init.body as string)
    expect(body.kind).toBe('io.agentxp.verification')
    expect(body.payload).toEqual({
      type: 'verification',
      data: { target_event_id: target, outcome: 'confirmed' },
    })
    expect(body.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(body.id).toMatch(/^[0-9a-f]{64}$/)

    const logged = db.db
      .prepare('SELECT outcome, session_id FROM verification_log WHERE target_event_id = ?')
      .get(target) as { outcome: string; session_id: string }
    expect(logged).toEqual({ outcome: 'confirmed', session_id: 's1' })
  })

  it('dedupes: each target is verified at most once', async () => {
    const target = 'e'.repeat(64)
    const netId = seedNetworkExperience(db, target)
    seedInjection(db, 's1', [netId], 100)
    seedReflection(db, 's1', 'succeeded', 200)
    seedInjection(db, 's2', [netId], 300)
    seedReflection(db, 's2', 'failed', 400)

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await publishVerifications(db, cfg)
    const second = await publishVerifications(db, cfg)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.published).toBe(0)
  })

  it('skips injections whose session has no reflection outcome', async () => {
    const netId = seedNetworkExperience(db, 'f'.repeat(64))
    seedInjection(db, 'lonely', [netId], 100)

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await publishVerifications(db, cfg)

    expect(r.published).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps all-failed to refuted and mixed to partial', async () => {
    const tFail = '1'.repeat(64)
    const tMix = '2'.repeat(64)
    const nFail = seedNetworkExperience(db, tFail)
    const nMix = seedNetworkExperience(db, tMix)
    seedInjection(db, 'sf', [nFail], 100)
    seedReflection(db, 'sf', 'failed', 200)
    seedInjection(db, 'sm', [nMix], 100)
    seedReflection(db, 'sm', 'partial', 200)
    seedReflection(db, 'sm', 'failed', 300)

    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { payload: { data: { outcome: string } } }
        seen.push(body.payload.data.outcome)
        return { ok: true, json: async () => ({}) }
      }),
    )

    await publishVerifications(db, cfg)

    expect(seen.sort()).toEqual(['partial', 'refuted'])
  })

  it('records nothing when relay rejects the event', async () => {
    const target = '3'.repeat(64)
    const netId = seedNetworkExperience(db, target)
    seedInjection(db, 's', [netId], 100)
    seedReflection(db, 's', 'succeeded', 200)

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))

    const r = await publishVerifications(db, cfg)

    expect(r.published).toBe(0)
    expect(r.errors).toBe(1)
    const hit = db.db
      .prepare('SELECT 1 FROM verification_log WHERE target_event_id = ?')
      .get(target)
    expect(hit).toBeUndefined()
  })
})
