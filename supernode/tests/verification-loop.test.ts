// Verification Loop — end-to-end wiring between events and pulse/scoring.
// Covers two previously-broken seams:
//   1. io.agentxp.verification events arriving at /api/v1/events had no side
//      effects (now: award impact points + transition pulse to 'verified').
//   2. /api/v1/search returned results without logging a pulse hit (now:
//      cross-operator search transitions dormant -> discovered).

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
  type AgentKey,
} from '@serendip/protocol'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'
import { PulseStateMachine } from '../src/agentxp/pulse'

type App = ReturnType<typeof createApp>

async function publishExperience(
  app: App,
  agentKey: AgentKey,
  overrides: Record<string, unknown> = {},
): Promise<{ eventId: string }> {
  const payload = {
    type: 'experience',
    data: {
      what: 'Docker DNS resolution failure',
      tried: 'Restarted Docker daemon',
      outcome: 'succeeded',
      learned: 'Restart clears DNS cache',
      ...overrides,
    },
  }
  const unsigned = createEvent('intent.broadcast', payload, ['docker', 'networking'])
  const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
  const event = await signEvent(withOp, agentKey)
  const res = await app.request('/api/v1/events', {
    method: 'POST',
    body: JSON.stringify(event),
    headers: { 'Content-Type': 'application/json' },
  })
  expect(res.status).toBe(201)
  return { eventId: event.id }
}

async function publishVerification(
  app: App,
  verifier: AgentKey,
  targetEventId: string,
  outcome: 'confirmed' | 'refuted' | 'partial' = 'confirmed',
): Promise<Response> {
  const payload = {
    type: 'verification',
    data: { target_event_id: targetEventId, outcome },
  }
  const unsigned = createEvent('io.agentxp.verification', payload, ['verification'])
  const withOp = { ...unsigned, operator_pubkey: verifier.delegatedBy }
  const event = await signEvent(withOp, verifier)
  return app.request('/api/v1/events', {
    method: 'POST',
    body: JSON.stringify(event),
    headers: { 'Content-Type': 'application/json' },
  })
}

function getExperienceId(db: Database.Database, eventId: string): number {
  const row = db
    .prepare('SELECT id FROM experiences WHERE event_id = ?')
    .get(eventId) as { id: number } | undefined
  if (!row) throw new Error(`experience not found for event ${eventId}`)
  return row.id
}

describe('Verification event routing', () => {
  let db: Database.Database
  let app: App

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  it('cross-operator verification awards 15 points (5 base × 3 cross-circle)', async () => {
    const authorOp = await generateOperatorKey()
    const author = await delegateAgentKey(authorOp, 'author', 90)
    const verifierOp = await generateOperatorKey()
    const verifier = await delegateAgentKey(verifierOp, 'verifier', 90)

    const { eventId } = await publishExperience(app, author)
    const expId = getExperienceId(db, eventId)

    const res = await publishVerification(app, verifier, eventId)
    expect(res.status).toBe(201)

    const row = db
      .prepare(
        `SELECT action, points FROM impact_ledger
         WHERE experience_id = ? AND action = 'verified'`,
      )
      .get(expId) as { action: string; points: number } | undefined

    expect(row).toBeDefined()
    expect(row!.points).toBe(15)
  })

  it('same-operator verification awards 0 points (anti-gaming)', async () => {
    const opKey = await generateOperatorKey()
    const author = await delegateAgentKey(opKey, 'author', 90)
    const sibling = await delegateAgentKey(opKey, 'sibling', 90)

    const { eventId } = await publishExperience(app, author)
    const expId = getExperienceId(db, eventId)

    const res = await publishVerification(app, sibling, eventId)
    expect(res.status).toBe(201)

    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(points), 0) AS total
         FROM impact_ledger
         WHERE experience_id = ? AND action = 'verified'`,
      )
      .get(expId) as { total: number }

    expect(totals.total).toBe(0)
  })

  it('verification on dormant experience transitions pulse through discovered → verified', async () => {
    const authorOp = await generateOperatorKey()
    const author = await delegateAgentKey(authorOp, 'author', 90)
    const verifierOp = await generateOperatorKey()
    const verifier = await delegateAgentKey(verifierOp, 'verifier', 90)

    const { eventId } = await publishExperience(app, author)
    const expId = getExperienceId(db, eventId)

    const pulse = new PulseStateMachine(db)
    expect(pulse.getPulseState(expId)).toBe('dormant')

    const res = await publishVerification(app, verifier, eventId)
    expect(res.status).toBe(201)

    expect(pulse.getPulseState(expId)).toBe('verified')
  })

  it('verification targeting a non-existent event is rejected with 400', async () => {
    const verifierOp = await generateOperatorKey()
    const verifier = await delegateAgentKey(verifierOp, 'verifier', 90)
    const bogusEventId = 'f'.repeat(64)

    const res = await publishVerification(app, verifier, bogusEventId)
    expect(res.status).toBe(400)
  })
})

describe('Search → pulse.handleSearchHit wiring', () => {
  let db: Database.Database
  let app: App

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  it('cross-operator search transitions dormant experience to discovered', async () => {
    const authorOp = await generateOperatorKey()
    const author = await delegateAgentKey(authorOp, 'author', 90)
    const searcherOp = await generateOperatorKey()

    // Seed a fully-indexed experience so search can return it.
    const payload = {
      type: 'experience',
      data: {
        what: 'Docker DNS fix',
        tried: 'Restart daemon',
        outcome: 'succeeded',
        learned: 'works',
      },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['docker', 'networking'])
    const withOp = { ...unsigned, operator_pubkey: author.delegatedBy }
    const event = await signEvent(withOp, author)
    const mockEmbedding = JSON.stringify([0.1, 0.2, 0.3, 0.4, 0.5])
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.id, event.pubkey, author.delegatedBy, event.kind, event.created_at,
      JSON.stringify(event.payload), JSON.stringify(event.tags), event.visibility, event.sig, now)
    db.prepare(`
      INSERT INTO experiences (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, is_failure, embedding, embedding_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'indexed', ?)
    `).run(event.id, event.pubkey, author.delegatedBy, 'Docker DNS fix', 'Restart daemon', 'succeeded', 'works',
      JSON.stringify(['docker', 'networking']), 'public', mockEmbedding, event.created_at)

    const expId = getExperienceId(db, event.id)
    const pulse = new PulseStateMachine(db)
    expect(pulse.getPulseState(expId)).toBe('dormant')

    const res = await app.request(
      `/api/v1/search?q=docker&tags=docker&operator_pubkey=${searcherOp.publicKey}`,
    )
    expect(res.status).toBe(200)

    expect(pulse.getPulseState(expId)).toBe('discovered')
  })

  it('same-operator search does NOT transition pulse state (anti-gaming)', async () => {
    const authorOp = await generateOperatorKey()
    const author = await delegateAgentKey(authorOp, 'author', 90)

    const payload = {
      type: 'experience',
      data: {
        what: 'Docker DNS fix',
        tried: 'Restart daemon',
        outcome: 'succeeded',
        learned: 'works',
      },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['docker'])
    const withOp = { ...unsigned, operator_pubkey: author.delegatedBy }
    const event = await signEvent(withOp, author)
    const mockEmbedding = JSON.stringify([0.1, 0.2, 0.3, 0.4, 0.5])
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.id, event.pubkey, author.delegatedBy, event.kind, event.created_at,
      JSON.stringify(event.payload), JSON.stringify(event.tags), event.visibility, event.sig, now)
    db.prepare(`
      INSERT INTO experiences (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, is_failure, embedding, embedding_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'indexed', ?)
    `).run(event.id, event.pubkey, author.delegatedBy, 'Docker DNS fix', 'Restart daemon', 'succeeded', 'works',
      JSON.stringify(['docker']), 'public', mockEmbedding, event.created_at)

    const expId = getExperienceId(db, event.id)
    const pulse = new PulseStateMachine(db)

    const res = await app.request(
      `/api/v1/search?q=docker&tags=docker&operator_pubkey=${author.delegatedBy}`,
    )
    expect(res.status).toBe(200)

    expect(pulse.getPulseState(expId)).toBe('dormant')
  })
})
