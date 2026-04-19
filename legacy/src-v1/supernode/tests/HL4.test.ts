// HL4 Test Suite: Emotional Milestones
// TDD: Milestones fire at the right moment, only once, with emotional weight.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'
import { checkAndFireMilestone, getMilestoneMessage, checkAllMilestones } from '../src/agentxp/human-layer/milestones'
import { generateOperatorKey, delegateAgentKey, createEvent, signEvent } from '@serendip/protocol'

describe('HL4: Emotional Milestones', () => {
  let app: ReturnType<typeof createApp>
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  // Test 1: checkAndFireMilestone fires milestone once and stores in milestones table
  it('checkAndFireMilestone fires milestone and stores in DB', () => {
    const opPubkey = 'op-hl4a-' + Date.now()
    const fired = checkAndFireMilestone(db, opPubkey, 'first_experience')
    expect(fired).toBe(true)

    const row = db
      .prepare("SELECT * FROM milestones WHERE operator_pubkey = ? AND type = 'first_experience'")
      .get(opPubkey)
    expect(row).toBeDefined()
  })

  // Test 2: Milestone fires only once — calling again returns false
  it('checkAndFireMilestone fires only once per operator per type', () => {
    const opPubkey = 'op-hl4b-' + Date.now()
    const first = checkAndFireMilestone(db, opPubkey, 'first_experience')
    const second = checkAndFireMilestone(db, opPubkey, 'first_experience')
    expect(first).toBe(true)
    expect(second).toBe(false)

    // Only one row in milestones
    const count = db
      .prepare("SELECT COUNT(*) as c FROM milestones WHERE operator_pubkey = ? AND type = 'first_experience'")
      .get(opPubkey) as { c: number }
    expect(count.c).toBe(1)
  })

  // Test 3: Milestone delivers notification to operator_notifications
  it('checkAndFireMilestone delivers notification to operator', () => {
    const opPubkey = 'op-hl4c-' + Date.now()
    checkAndFireMilestone(db, opPubkey, 'first_resolved_hit')

    const notif = db
      .prepare("SELECT * FROM operator_notifications WHERE operator_pubkey = ? AND type = 'milestone'")
      .get(opPubkey) as { content: string } | undefined
    expect(notif).toBeDefined()
    expect(notif!.content).toContain('succeeded')  // from first_resolved_hit message
  })

  // Test 4: first_experience message has emotional weight
  it('getMilestoneMessage for first_experience has emotional weight', () => {
    const msg = getMilestoneMessage('first_experience')
    expect(msg).toContain('first lesson')
    expect(msg).not.toContain('Congratulations!')
    expect(msg).not.toContain('Achievement unlocked')
  })

  // Test 5: first_resolved_hit message references helping others
  it('getMilestoneMessage for first_resolved_hit references helping others', () => {
    const msg = getMilestoneMessage('first_resolved_hit')
    expect(msg).toContain('succeeded')
  })

  // Test 6: first_proactive_recall message has emotional weight
  it('getMilestoneMessage for first_proactive_recall has emotional content', () => {
    const msg = getMilestoneMessage('first_proactive_recall')
    expect(msg).toContain('remembered')
  })

  // Test 7: day_30 message references 30 days
  it('getMilestoneMessage for day_30 mentions thirty days', () => {
    const msg = getMilestoneMessage('day_30')
    expect(msg.toLowerCase()).toContain('thirty')
  })

  // Test 8: checkAllMilestones fires first_experience after first publish
  it('checkAllMilestones fires first_experience after first publish via API', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-hl4', 90)

    const payload = { type: 'experience', data: { what: 'First lesson', tried: 'try', outcome: 'succeeded', learned: 'learned' } }
    const unsigned = createEvent('intent.broadcast', payload, ['test'])
    const withOp = { ...unsigned, operator_pubkey: opKey.publicKey }
    const event = await signEvent(withOp, agentKey)
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    })

    // Manually trigger checkAllMilestones (in prod this would be called post-publish)
    checkAllMilestones(db, opKey.publicKey)

    const milestone = db
      .prepare("SELECT * FROM milestones WHERE operator_pubkey = ? AND type = 'first_experience'")
      .get(opKey.publicKey)
    expect(milestone).toBeDefined()
  })

  // Helper: insert experience with matching event row to satisfy FK
  function insertExperienceWithEvent(opPubkey: string, createdAt: number): void {
    const pseudoId = `evt-test-${opPubkey.slice(0, 8)}-${createdAt}-${Math.random().toString(36).slice(2, 6)}`
    db.prepare(`
      INSERT OR IGNORE INTO events
        (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, 'intent.broadcast', ?, '{}', '[]', 'public', 'testsig', ?)
    `).run(pseudoId, opPubkey, opPubkey, createdAt, createdAt)

    db.prepare(`
      INSERT INTO experiences
        (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, is_failure, embedding_status, created_at)
      VALUES (?, ?, ?, 'lesson', 'tried', 'succeeded', 'learned', '[]', 'public', 0, 'pending', ?)
    `).run(pseudoId, opPubkey, opPubkey, createdAt)
  }

  // Test 9: day_30 fires when first experience is 30+ days old
  it('checkAllMilestones fires day_30 when agent is 30+ days old', () => {
    const opPubkey = 'op-hl4d-' + Date.now()
    const thirtyOneDaysAgo = Math.floor(Date.now() / 1000) - 31 * 86400

    insertExperienceWithEvent(opPubkey, thirtyOneDaysAgo)
    checkAllMilestones(db, opPubkey)

    const day30 = db
      .prepare("SELECT * FROM milestones WHERE operator_pubkey = ? AND type = 'day_30'")
      .get(opPubkey)
    expect(day30).toBeDefined()
  })

  // Test 10: day_30 does NOT fire when agent is < 30 days old
  it('checkAllMilestones does NOT fire day_30 when agent is < 30 days old', () => {
    const opPubkey = 'op-hl4e-' + Date.now()
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 86400

    insertExperienceWithEvent(opPubkey, tenDaysAgo)
    checkAllMilestones(db, opPubkey)

    const day30 = db
      .prepare("SELECT * FROM milestones WHERE operator_pubkey = ? AND type = 'day_30'")
      .get(opPubkey)
    expect(day30).toBeUndefined()
  })
})
