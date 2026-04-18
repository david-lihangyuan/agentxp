import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDb, type Db } from '../db'
import { pullPulseEvents, type PluginConfig } from '../service/publisher'

const EVENT_A = 'a'.repeat(64)
const EVENT_B = 'b'.repeat(64)

function seedPublishedLog(db: Db, relayEventId: string, pulseState: string): void {
  db.db
    .prepare(
      `INSERT INTO reflections (
        session_id, source_file, category, title, tried, expected, outcome, learned,
        why_wrong, tags, quality_score, published, relay_event_id, visibility, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'sess',
      null,
      'lesson',
      't',
      'tried',
      null,
      'succeeded',
      'learned',
      null,
      '[]',
      1,
      1,
      relayEventId,
      'public',
      0,
      0
    )
  db.db
    .prepare(
      `INSERT INTO published_log (
        reflection_id, relay_event_id, pulse_state, published_at
      ) VALUES (?, ?, ?, ?)`
    )
    .run(1, relayEventId, pulseState, 0)
}

function readPulseState(db: Db, relayEventId: string): string {
  const row = db.db
    .prepare('SELECT pulse_state FROM published_log WHERE relay_event_id = ?')
    .get(relayEventId) as { pulse_state: string } | undefined
  return row?.pulse_state ?? 'MISSING'
}

function mockPulseResponse(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      json: async () => body,
    }))
  )
}

const config: PluginConfig = {
  relayUrl: 'http://relay.test',
  operatorPubkey: 'op-pk',
  agentKey: '0'.repeat(64),
}

describe('pullPulseEvents: pulse feedback loop', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.db.close()
  })

  it('advances dormant -> discovered when relay reports a discovered highlight', async () => {
    seedPublishedLog(db, EVENT_A, 'dormant')
    mockPulseResponse({
      highlights: [{ event_id: EVENT_A, type: 'discovered' }],
      summary: '1 discovered',
      total: 1,
    })

    await pullPulseEvents(db, config)

    expect(readPulseState(db, EVENT_A)).toBe('discovered')
  })

  it('advances to the highest-ranked state across multiple highlights', async () => {
    seedPublishedLog(db, EVENT_A, 'dormant')
    mockPulseResponse({
      highlights: [
        { event_id: EVENT_A, type: 'discovered' },
        { event_id: EVENT_A, type: 'verified' },
      ],
      summary: '',
      total: 2,
    })

    await pullPulseEvents(db, config)

    expect(readPulseState(db, EVENT_A)).toBe('verified')
  })

  it('never downgrades pulse_state', async () => {
    seedPublishedLog(db, EVENT_A, 'verified')
    mockPulseResponse({
      highlights: [{ event_id: EVENT_A, type: 'discovered' }],
      summary: '',
      total: 1,
    })

    await pullPulseEvents(db, config)

    expect(readPulseState(db, EVENT_A)).toBe('verified')
  })

  it('ignores resolved_hit and subscription_match event types', async () => {
    seedPublishedLog(db, EVENT_A, 'dormant')
    mockPulseResponse({
      highlights: [
        { event_id: EVENT_A, type: 'resolved_hit' },
        { event_id: EVENT_A, type: 'subscription_match' },
      ],
      summary: '',
      total: 2,
    })

    await pullPulseEvents(db, config)

    expect(readPulseState(db, EVENT_A)).toBe('dormant')
  })

  it('tolerates legacy array response, empty body, and non-ok responses', async () => {
    seedPublishedLog(db, EVENT_A, 'dormant')

    mockPulseResponse([{ event_id: EVENT_A, type: 'discovered' }])
    await pullPulseEvents(db, config)
    expect(readPulseState(db, EVENT_A)).toBe('dormant')

    mockPulseResponse({ highlights: [] })
    await pullPulseEvents(db, config)
    expect(readPulseState(db, EVENT_A)).toBe('dormant')

    mockPulseResponse({ highlights: [{ event_id: EVENT_A, type: 'discovered' }] }, false)
    await pullPulseEvents(db, config)
    expect(readPulseState(db, EVENT_A)).toBe('dormant')
  })

  it('leaves unrelated rows untouched', async () => {
    seedPublishedLog(db, EVENT_A, 'dormant')
    mockPulseResponse({
      highlights: [{ event_id: EVENT_B, type: 'verified' }],
      summary: '',
      total: 1,
    })

    await pullPulseEvents(db, config)

    expect(readPulseState(db, EVENT_A)).toBe('dormant')
  })
})
