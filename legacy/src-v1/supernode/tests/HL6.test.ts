// HL6 Test Suite: Trust Evolution
// TDD: Trust levels, trajectories, API endpoint.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'
import { trackTrustEvent, getTrustLevel } from '../src/agentxp/human-layer/trust'

describe('HL6: Trust Evolution', () => {
  let app: ReturnType<typeof createApp>
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  // Test 1: New agent starts at level='new', score=0
  it('new agent starts at level=new and score=0', () => {
    const agentPubkey = 'agent-hl6a-' + Date.now()
    const trust = getTrustLevel(db, agentPubkey)
    expect(trust.level).toBe('new')
    expect(trust.score).toBe(0)
  })

  // Test 2: 10 success events push agent to 'established' level
  it('10 success events push trust to established level', () => {
    const agentPubkey = 'agent-hl6b-' + Date.now()
    for (let i = 0; i < 10; i++) {
      trackTrustEvent(db, agentPubkey, 'success')
    }
    const trust = getTrustLevel(db, agentPubkey)
    expect(trust.score).toBe(10)
    expect(trust.level).toBe('established')
  })

  // Test 3: 50 success events push to 'trusted' level
  it('50 success events push trust to trusted level', () => {
    const agentPubkey = 'agent-hl6c-' + Date.now()
    for (let i = 0; i < 50; i++) {
      trackTrustEvent(db, agentPubkey, 'success')
    }
    const trust = getTrustLevel(db, agentPubkey)
    expect(trust.score).toBe(50)
    expect(trust.level).toBe('trusted')
  })

  // Test 4: correct_recall awards more points (3 per event)
  it('correct_recall event awards 3 points', () => {
    const agentPubkey = 'agent-hl6d-' + Date.now()
    trackTrustEvent(db, agentPubkey, 'correct_recall')
    const trust = getTrustLevel(db, agentPubkey)
    expect(trust.score).toBe(3)
  })

  // Test 5: verification event awards 2 points
  it('verification event awards 2 points', () => {
    const agentPubkey = 'agent-hl6e-' + Date.now()
    trackTrustEvent(db, agentPubkey, 'verification')
    const trust = getTrustLevel(db, agentPubkey)
    expect(trust.score).toBe(2)
  })

  // Test 6: 200+ points = exemplary level
  it('200+ success events reach exemplary level', () => {
    const agentPubkey = 'agent-hl6f-' + Date.now()
    // 67 correct_recalls = 201 points
    for (let i = 0; i < 67; i++) {
      trackTrustEvent(db, agentPubkey, 'correct_recall')
    }
    const trust = getTrustLevel(db, agentPubkey)
    expect(trust.score).toBe(201)
    expect(trust.level).toBe('exemplary')
  })

  // Test 7: Trajectory is 'rising' when recent activity is higher than prior
  it('trajectory is rising when recent activity exceeds prior period', () => {
    const agentPubkey = 'agent-hl6g-' + Date.now()

    // Insert events directly with timestamps: recent (last 7 days) > prior (7-14 days ago)
    const now = Math.floor(Date.now() / 1000)
    const recentTime = now - 86400 * 2   // 2 days ago
    const priorTime = now - 86400 * 10   // 10 days ago (outside window)

    // Add one event in prior period
    db.prepare('INSERT INTO agent_trust_events (agent_pubkey, event_type, created_at) VALUES (?, ?, ?)')
      .run(agentPubkey, 'success', priorTime)

    // Add more events in recent period
    for (let i = 0; i < 5; i++) {
      db.prepare('INSERT INTO agent_trust_events (agent_pubkey, event_type, created_at) VALUES (?, ?, ?)')
        .run(agentPubkey, 'success', recentTime)
    }

    const trust = getTrustLevel(db, agentPubkey)
    expect(trust.trajectory).toBe('rising')
  })

  // Test 8: Trajectory is 'stable' for new agent with no events
  it('trajectory is stable when no events exist', () => {
    const agentPubkey = 'agent-hl6h-' + Date.now()
    const trust = getTrustLevel(db, agentPubkey)
    expect(trust.trajectory).toBe('stable')
  })

  // Test 9: GET /api/v1/agents/:pubkey/trust returns trust info
  it('GET /api/v1/agents/:pubkey/trust returns trust level and trajectory', async () => {
    const agentPubkey = 'agent-hl6i-' + Date.now()
    trackTrustEvent(db, agentPubkey, 'success')
    trackTrustEvent(db, agentPubkey, 'correct_recall')

    const res = await app.request(`/api/v1/agents/${agentPubkey}/trust`)
    expect(res.status).toBe(200)
    const body = await res.json() as { level: string; score: number; trajectory: string }
    expect(body.level).toBeDefined()
    expect(body.score).toBeDefined()
    expect(body.trajectory).toBeDefined()
    expect(['new', 'established', 'trusted', 'exemplary']).toContain(body.level)
    expect(['rising', 'stable', 'falling']).toContain(body.trajectory)
  })

  // Test 10: trackTrustEvent returns error for unknown event_type
  it('trackTrustEvent returns error for unknown event type', () => {
    const agentPubkey = 'agent-hl6j-' + Date.now()
    const result = trackTrustEvent(db, agentPubkey, 'invalid_type')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('unknown event_type')
    }
  })
})
