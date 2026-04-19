// HL5 Test Suite: Legacy View
// TDD: GET /api/v1/operator/:pubkey/legacy returns meaningful legacy data.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'
import { getLegacyView } from '../src/agentxp/human-layer/legacy'
import { generateOperatorKey, delegateAgentKey, createEvent, signEvent } from '@serendip/protocol'

describe('HL5: Legacy View', () => {
  let app: ReturnType<typeof createApp>
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  // Helper: publish experience via API
  async function publishExperience(
    opPubkey: string,
    agentKey: Awaited<ReturnType<typeof delegateAgentKey>>,
    what: string = 'A useful lesson'
  ): Promise<void> {
    const payload = { type: 'experience', data: { what, tried: 'tried', outcome: 'succeeded', learned: 'learned' } }
    const unsigned = createEvent('intent.broadcast', payload, ['test'])
    const withOp = { ...unsigned, operator_pubkey: opPubkey }
    const event = await signEvent(withOp, agentKey)
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Test 1: Legacy API returns required fields
  it('GET /api/v1/operator/:pubkey/legacy returns required fields', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-hl5', 90)
    await publishExperience(opKey.publicKey, agentKey)

    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/legacy`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['still_active_count']).toBeDefined()
    expect(body['helped_succeed_count']).toBeDefined()
    expect(body['total_experiences']).toBeDefined()
    expect(body['display']).toBeDefined()
    expect(typeof body['display']).toBe('string')
  })

  // Test 2: display string contains "still helping agents today"
  it('legacy display contains "still helping agents today"', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-hl5b', 90)
    await publishExperience(opKey.publicKey, agentKey)

    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/legacy`)
    const body = await res.json() as { display: string }
    expect(body.display).toContain('still helping agents today')
  })

  // Test 3: total_experiences matches actual count
  it('total_experiences matches actual experience count', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-hl5c', 90)
    await publishExperience(opKey.publicKey, agentKey, 'First lesson')
    await publishExperience(opKey.publicKey, agentKey, 'Second lesson')

    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/legacy`)
    const body = await res.json() as { total_experiences: number }
    expect(body.total_experiences).toBe(2)
  })

  // Test 4: helped_succeed_count equals resolved_hit events
  it('helped_succeed_count equals count of resolved_hit events', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-hl5d', 90)
    await publishExperience(opKey.publicKey, agentKey)

    // Get the experience id
    const exp = db
      .prepare('SELECT id FROM experiences WHERE operator_pubkey = ? LIMIT 1')
      .get(opKey.publicKey) as { id: number } | undefined
    expect(exp).toBeDefined()

    // Add a resolved_hit pulse event
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT INTO pulse_events (experience_id, type, from_pubkey, operator_pubkey, created_at)
      VALUES (?, 'resolved_hit', 'searcher-key', ?, ?)
    `).run(exp!.id, opKey.publicKey, now)

    const legacy = getLegacyView(db, opKey.publicKey)
    expect(legacy.helped_succeed_count).toBe(1)
  })

  // Test 5: oldest_experience_date is defined when experiences exist
  it('oldest_experience_date is defined when experiences exist', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-hl5e', 90)
    await publishExperience(opKey.publicKey, agentKey)

    const legacy = getLegacyView(db, opKey.publicKey)
    expect(legacy.oldest_experience_date).not.toBeNull()
    expect(typeof legacy.oldest_experience_date).toBe('string')
  })

  // Test 6: oldest_experience_date is null when no experiences exist
  it('oldest_experience_date is null when no experiences', () => {
    const legacy = getLegacyView(db, 'op-no-exps-' + Date.now())
    expect(legacy.oldest_experience_date).toBeNull()
    expect(legacy.total_experiences).toBe(0)
  })

  // Test 7: still_active_count counts experiences with recent pulse activity
  it('still_active_count counts experiences with recent pulse activity', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-hl5f', 90)
    await publishExperience(opKey.publicKey, agentKey)

    // Get the experience id
    const exp = db
      .prepare('SELECT id FROM experiences WHERE operator_pubkey = ? LIMIT 1')
      .get(opKey.publicKey) as { id: number } | undefined

    // Add a discovered pulse event (recent)
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT INTO pulse_events (experience_id, type, from_pubkey, operator_pubkey, created_at)
      VALUES (?, 'discovered', 'searcher', ?, ?)
    `).run(exp!.id, opKey.publicKey, now)

    // Update last_activity_at to recent
    db.prepare('UPDATE experiences SET last_activity_at = ? WHERE id = ?').run(now, exp!.id)

    const legacy = getLegacyView(db, opKey.publicKey)
    expect(legacy.still_active_count).toBeGreaterThan(0)
  })
})
