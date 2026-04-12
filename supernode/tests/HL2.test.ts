// HL2 Test Suite: Agent Speaks to Operator
// TDD: Pattern detection, notification delivery, notification API.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'
import { detectPattern, generateObservation, deliverNotification } from '../src/agentxp/human-layer/agent-voice'

describe('HL2: Agent Speaks to Operator', () => {
  let app: ReturnType<typeof createApp>
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  // Helpers to insert experience records
  function insertExperience(
    agentPubkey: string,
    operatorPubkey: string,
    what: string,
    learned: string,
    createdAt: number
  ): void {
    const pseudoId = `evt-${Math.random().toString(36).slice(2)}-${createdAt}`
    // Insert matching event row to satisfy FK constraint
    db.prepare(`
      INSERT OR IGNORE INTO events
        (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, 'intent.broadcast', ?, '{}', '[]', 'public', 'testsig', ?)
    `).run(pseudoId, agentPubkey, operatorPubkey, createdAt, createdAt)

    db.prepare(`
      INSERT INTO experiences
        (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, is_failure, embedding_status, created_at)
      VALUES (?, ?, ?, ?, 'tried something', 'failed', ?, '[]', 'public', 1, 'pending', ?)
    `).run(pseudoId, agentPubkey, operatorPubkey, what, learned, createdAt)
  }

  // Test 1: detectPattern returns true after 3+ occurrences in 7 days
  it('detectPattern returns true after 3+ pattern occurrences in 7 days', () => {
    const agentPubkey = 'agent-hl2-' + Date.now()
    const opPubkey = 'op-hl2-' + Date.now()
    const now = Math.floor(Date.now() / 1000)

    insertExperience(agentPubkey, opPubkey, 'missed cross-repo imports', 'import paths are tricky', now - 86400 * 2)
    insertExperience(agentPubkey, opPubkey, 'missed cross-repo imports again', 'same import issue', now - 86400)
    insertExperience(agentPubkey, opPubkey, 'missed cross-repo imports once more', 'still import problems', now - 3600)

    const detected = detectPattern(db, agentPubkey, 'import', 7, 3)
    expect(detected).toBe(true)
  })

  // Test 2: detectPattern returns false if spread over 8+ days
  it('detectPattern returns false if occurrences spread over 8+ days', () => {
    const agentPubkey = 'agent-hl2b-' + Date.now()
    const opPubkey = 'op-hl2b-' + Date.now()
    const now = Math.floor(Date.now() / 1000)

    // Events older than 7 days window
    insertExperience(agentPubkey, opPubkey, 'same import issue', 'import problem', now - 86400 * 10)
    insertExperience(agentPubkey, opPubkey, 'same import issue again', 'import problem', now - 86400 * 9)
    insertExperience(agentPubkey, opPubkey, 'import issue again', 'import problem', now - 86400 * 8)

    const detected = detectPattern(db, agentPubkey, 'import', 7, 3)
    expect(detected).toBe(false)
  })

  // Test 3: generateObservation returns observational tone message
  it('generateObservation returns observational message not a complaint', () => {
    const msg = generateObservation('cross-repo imports')
    // Should match observational pattern
    expect(msg).toMatch(/I've (noticed|encountered|hit)/i)
    // Should NOT be a complaint or instruction
    expect(msg).not.toMatch(/you should|you must|failed/i)
    // Should mention mistakes.md
    expect(msg).toContain('mistakes.md')
  })

  // Test 4: deliverNotification stores notification in DB
  it('deliverNotification stores notification in operator_notifications', () => {
    const opPubkey = 'op-hl2c-' + Date.now()
    const result = deliverNotification(db, opPubkey, 'Test notification message', 'agent_pattern')
    expect(result.ok).toBe(true)
    expect(typeof result.id).toBe('number')

    const row = db
      .prepare("SELECT * FROM operator_notifications WHERE operator_pubkey = ? AND type = 'agent_pattern'")
      .get(opPubkey) as { content: string; read: number } | undefined
    expect(row).toBeDefined()
    expect(row!.content).toBe('Test notification message')
    expect(row!.read).toBe(0)
  })

  // Test 5: GET /api/v1/operator/:pubkey/notifications returns unread notifications
  it('GET /api/v1/operator/:pubkey/notifications returns unread notifications', async () => {
    const opPubkey = 'op-hl2d-' + Date.now()
    deliverNotification(db, opPubkey, 'First notification', 'agent_pattern')
    deliverNotification(db, opPubkey, 'Second notification', 'milestone')

    const res = await app.request(`/api/v1/operator/${opPubkey}/notifications`)
    expect(res.status).toBe(200)
    const body = await res.json() as { notifications: Array<{ type: string; content: string }> }
    expect(Array.isArray(body.notifications)).toBe(true)
    expect(body.notifications.length).toBe(2)
  })

  // Test 6: POST /api/v1/operator/:pubkey/notifications/:id/read marks as read
  it('POST /api/v1/operator/:pubkey/notifications/:id/read marks notification as read', async () => {
    const opPubkey = 'op-hl2e-' + Date.now()
    const notif = deliverNotification(db, opPubkey, 'Notification to read', 'agent_pattern')

    const res = await app.request(
      `/api/v1/operator/${opPubkey}/notifications/${notif.id}/read`,
      { method: 'POST' }
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)

    // Should no longer appear in unread list
    const listRes = await app.request(`/api/v1/operator/${opPubkey}/notifications`)
    const listBody = await listRes.json() as { notifications: unknown[] }
    expect(listBody.notifications.length).toBe(0)
  })

  // Test 7: GET notifications returns empty array when all read
  it('GET notifications returns empty array when no unread notifications', async () => {
    const opPubkey = 'op-hl2f-' + Date.now()
    const res = await app.request(`/api/v1/operator/${opPubkey}/notifications`)
    expect(res.status).toBe(200)
    const body = await res.json() as { notifications: unknown[] }
    expect(body.notifications).toEqual([])
  })

  // Test 8: POST to mark non-existent notification returns 404
  it('POST mark non-existent notification returns 404', async () => {
    const opPubkey = 'op-hl2g-' + Date.now()
    const res = await app.request(
      `/api/v1/operator/${opPubkey}/notifications/99999/read`,
      { method: 'POST' }
    )
    expect(res.status).toBe(404)
  })
})
