// B5b Test Suite: Experience Subscriptions
// TDD: Subscribe, match on new experience, notification via pulse event, list subscriptions.
import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  generateOperatorKey,
  delegateAgentKey,
} from '@serendip/protocol'
import { runMigrations } from '../src/db'
import { SubscriptionManager } from '../src/agentxp/subscriptions'
import { createApp } from '../src/app'

// Valid 64-char hex pubkeys
const VALID_PUBKEYS: Record<string, string> = {
  a: 'a'.repeat(64),
  b: 'b'.repeat(64),
  c: 'c'.repeat(64),
  d: 'd'.repeat(64),
  e: 'e'.repeat(64),
  f: 'f'.repeat(64),
  g: '0'.repeat(63) + '1',
  h: '0'.repeat(63) + '2',
  i: '0'.repeat(63) + '3',
  j: '0'.repeat(63) + '4',
  k: '0'.repeat(63) + '5',
  l: '0'.repeat(63) + '6',
}

function makeValidPubkey(char: string): string {
  return VALID_PUBKEYS[char] ?? '0'.repeat(64)
}

describe('B5b: Experience Subscriptions', () => {
  let db: Database
  let manager: SubscriptionManager

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    manager = new SubscriptionManager(db)
  })

  it('subscribe stores query for agent pubkey', async () => {
    const pubkey = makeValidPubkey('a')
    const result = manager.subscribe({
      pubkey,
      operatorPubkey: pubkey,
      query: 'kubernetes rate limiting',
    })
    expect(result.ok).toBe(true)
    expect(result.id).toBeDefined()

    const subs = db.query('SELECT * FROM subscriptions WHERE pubkey = ?').all(pubkey) as Array<Record<string, unknown>>
    expect(subs.length).toBe(1)
    expect(subs[0]['query']).toBe('kubernetes rate limiting')
  })

  it('matching experience triggers subscription_match pulse event', async () => {
    const subscriberPubkey = makeValidPubkey('b')
    manager.subscribe({
      pubkey: subscriberPubkey,
      operatorPubkey: subscriberPubkey,
      query: 'kubernetes',
    })

    // Seed an experience in the DB
    const expEventId = 'exp_event_' + Date.now()
    db.prepare(`
      INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, 'intent.broadcast', ?, '{}', '[]', 'public', 'sig', ?)
    `).run(expEventId, makeValidPubkey('c'), makeValidPubkey('c'), Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))

    db.prepare(`
      INSERT INTO experiences (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, is_failure, embedding_status, created_at)
      VALUES (?, ?, ?, ?, 'Checked DNS config', 'succeeded', 'DNS config was wrong', '["kubernetes","networking"]', 'public', 0, 'pending', ?)
    `).run(expEventId, makeValidPubkey('c'), makeValidPubkey('c'), 'kubernetes DNS resolution issue', Math.floor(Date.now() / 1000))

    const exp = db.query('SELECT id FROM experiences WHERE event_id = ?').get(expEventId) as { id: number }

    await manager.matchNewExperience(
      exp.id,
      'kubernetes DNS resolution issue',
      'Checked DNS configuration and network policies',
      'DNS config was wrong for the cluster setup',
      ['kubernetes', 'networking'],
      Math.floor(Date.now() / 1000)
    )

    const pulses = db.query(`
      SELECT * FROM pulse_events WHERE type = 'subscription_match' AND operator_pubkey = ?
    `).all(subscriberPubkey) as Array<Record<string, unknown>>
    expect(pulses.length).toBe(1)
  })

  it('non-matching experience does not trigger pulse event', async () => {
    const subscriberPubkey = makeValidPubkey('d')
    manager.subscribe({
      pubkey: subscriberPubkey,
      operatorPubkey: subscriberPubkey,
      query: 'kubernetes',
    })

    const expEventId = 'exp_event2_' + Date.now()
    db.prepare(`
      INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, 'intent.broadcast', ?, '{}', '[]', 'public', 'sig', ?)
    `).run(expEventId, makeValidPubkey('e'), makeValidPubkey('e'), Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))

    db.prepare(`
      INSERT INTO experiences (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, is_failure, embedding_status, created_at)
      VALUES (?, ?, ?, 'python pandas bug', 'Added dtype cast', 'succeeded', 'Always cast dtype', '["python","pandas"]', 'public', 0, 'pending', ?)
    `).run(expEventId, makeValidPubkey('e'), makeValidPubkey('e'), Math.floor(Date.now() / 1000))

    const exp = db.query('SELECT id FROM experiences WHERE event_id = ?').get(expEventId) as { id: number }

    await manager.matchNewExperience(
      exp.id,
      'python pandas bug',
      'Added dtype cast before merge',
      'Always cast dtype when merging DataFrames',
      ['python', 'pandas'],
      Math.floor(Date.now() / 1000)
    )

    const pulses = db.query(`
      SELECT * FROM pulse_events WHERE type = 'subscription_match' AND operator_pubkey = ?
    `).all(subscriberPubkey) as Array<Record<string, unknown>>
    expect(pulses.length).toBe(0)
  })

  it('listForOperator returns subscriptions for that operator', () => {
    const opPubkey = makeValidPubkey('f')
    manager.subscribe({ pubkey: opPubkey, operatorPubkey: opPubkey, query: 'docker' })
    manager.subscribe({ pubkey: opPubkey, operatorPubkey: opPubkey, query: 'kubernetes' })

    const subs = manager.listForOperator(opPubkey)
    expect(subs.length).toBe(2)
  })

  it('listForPubkey returns subscriptions for that pubkey', () => {
    const pubkey = makeValidPubkey('g')
    manager.subscribe({ pubkey, operatorPubkey: pubkey, query: 'python' })

    const subs = manager.listForPubkey(pubkey)
    expect(subs.length).toBe(1)
    expect(subs[0].query).toBe('python')
  })

  it('POST /api/v1/subscriptions creates subscription', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const pubkey = makeValidPubkey('h')

    const res = await app.request('/api/v1/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        pubkey,
        operator_pubkey: pubkey,
        query: 'docker networking',
      }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { ok: boolean; id: number }
    expect(body.ok).toBe(true)
    expect(body.id).toBeDefined()
  })

  it('GET /api/v1/subscriptions returns subscriptions for operator', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const pubkey = makeValidPubkey('i')

    // Create a subscription first
    await app.request('/api/v1/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ pubkey, operator_pubkey: pubkey, query: 'test query' }),
      headers: { 'content-type': 'application/json' },
    })

    const res = await app.request(`/api/v1/subscriptions?operator_pubkey=${pubkey}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { subscriptions: unknown[] }
    expect(Array.isArray(body.subscriptions)).toBe(true)
    expect(body.subscriptions.length).toBe(1)
  })

  it('POST /api/v1/subscriptions with missing fields returns 400', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ pubkey: makeValidPubkey('j') }), // missing query
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('tag-filtered subscription only matches experiences with required tags', async () => {
    const subscriberPubkey = makeValidPubkey('k')
    manager.subscribe({
      pubkey: subscriberPubkey,
      operatorPubkey: subscriberPubkey,
      query: 'networking',
      tags: ['kubernetes'],
    })

    const expEventId = 'exp_event3_' + Date.now()
    db.prepare(`
      INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, 'intent.broadcast', ?, '{}', '[]', 'public', 'sig', ?)
    `).run(expEventId, makeValidPubkey('l'), makeValidPubkey('l'), Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))

    db.prepare(`
      INSERT INTO experiences (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, is_failure, embedding_status, created_at)
      VALUES (?, ?, ?, 'Docker networking issue', 'Tested DNS', 'succeeded', 'DNS config matters', '["docker","networking"]', 'public', 0, 'pending', ?)
    `).run(expEventId, makeValidPubkey('l'), makeValidPubkey('l'), Math.floor(Date.now() / 1000))

    const exp = db.query('SELECT id FROM experiences WHERE event_id = ?').get(expEventId) as { id: number }

    // Experience has 'docker' + 'networking' but subscription requires 'kubernetes'
    await manager.matchNewExperience(
      exp.id,
      'Docker networking issue',
      'Tested DNS resolution',
      'DNS config matters for networking',
      ['docker', 'networking'],
      Math.floor(Date.now() / 1000)
    )

    const pulses = db.query(`
      SELECT * FROM pulse_events WHERE type = 'subscription_match' AND operator_pubkey = ?
    `).all(subscriberPubkey) as Array<Record<string, unknown>>
    expect(pulses.length).toBe(0) // Should NOT match: missing 'kubernetes' tag
  })
})
