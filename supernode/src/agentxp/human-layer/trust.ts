// Human Layer — HL6: Trust Evolution
// Tracks how agents build trust over time through consecutive successes, correct recalls, verifications.
// Trust levels: new (0-9), established (10-49), trusted (50-199), exemplary (200+)
// GET /api/v1/agents/:pubkey/trust

import type Database from 'better-sqlite3'
import type { Context, Hono } from 'hono'
import { logger } from '../../logger'

export type TrustLevel = 'new' | 'established' | 'trusted' | 'exemplary'
export type TrustTrajectory = 'rising' | 'stable' | 'falling'

export interface TrustInfo {
  level: TrustLevel
  score: number
  trajectory: TrustTrajectory
}

/** Points awarded per event type */
const TRUST_POINTS: Record<string, number> = {
  success: 1,
  correct_recall: 3,
  verification: 2,
}

/** Trust level thresholds */
function scoreToLevel(score: number): TrustLevel {
  if (score >= 200) return 'exemplary'
  if (score >= 50) return 'trusted'
  if (score >= 10) return 'established'
  return 'new'
}

/**
 * Record a trust-building event for an agent.
 * event_type: 'success' | 'correct_recall' | 'verification'
 */
export function trackTrustEvent(
  db: Database.Database,
  agentPubkey: string,
  eventType: string
): { ok: true; points: number } | { ok: false; error: string } {
  const validTypes = ['success', 'correct_recall', 'verification']
  if (!validTypes.includes(eventType)) {
    return { ok: false, error: `unknown event_type: ${eventType}` }
  }

  const now = Math.floor(Date.now() / 1000)
  const points = TRUST_POINTS[eventType] ?? 1

  try {
    db
      .prepare(
        'INSERT INTO agent_trust_events (agent_pubkey, event_type, created_at) VALUES (?, ?, ?)'
      )
      .run(agentPubkey, eventType, now)

    return { ok: true, points }
  } catch (err) {
    logger.error('Failed to record trust event', { error: String(err) })
    return { ok: false, error: 'failed to record trust event' }
  }
}

/**
 * Compute the current trust level and trajectory for an agent.
 * Score = sum of points from all trust events.
 * Trajectory = based on recent 7 days vs prior 7 days.
 */
export function getTrustLevel(db: Database.Database, agentPubkey: string): TrustInfo {
  // Total score
  const scoreRow = db
    .prepare(`
      SELECT
        SUM(CASE event_type
          WHEN 'success' THEN 1
          WHEN 'correct_recall' THEN 3
          WHEN 'verification' THEN 2
          ELSE 1
        END) as total
      FROM agent_trust_events
      WHERE agent_pubkey = ?
    `)
    .get(agentPubkey) as { total: number | null }

  const score = scoreRow.total ?? 0
  const level = scoreToLevel(score)

  // Trajectory: compare last 7 days vs prior 7 days
  const now = Math.floor(Date.now() / 1000)
  const sevenDaysAgo = now - 7 * 86400
  const fourteenDaysAgo = now - 14 * 86400

  const recentRow = db
    .prepare(`
      SELECT SUM(CASE event_type
        WHEN 'success' THEN 1
        WHEN 'correct_recall' THEN 3
        WHEN 'verification' THEN 2
        ELSE 1
      END) as points
      FROM agent_trust_events
      WHERE agent_pubkey = ? AND created_at >= ?
    `)
    .get(agentPubkey, sevenDaysAgo) as { points: number | null }

  const priorRow = db
    .prepare(`
      SELECT SUM(CASE event_type
        WHEN 'success' THEN 1
        WHEN 'correct_recall' THEN 3
        WHEN 'verification' THEN 2
        ELSE 1
      END) as points
      FROM agent_trust_events
      WHERE agent_pubkey = ? AND created_at >= ? AND created_at < ?
    `)
    .get(agentPubkey, fourteenDaysAgo, sevenDaysAgo) as { points: number | null }

  const recentPoints = recentRow.points ?? 0
  const priorPoints = priorRow.points ?? 0

  let trajectory: TrustTrajectory = 'stable'
  if (recentPoints > priorPoints) {
    trajectory = 'rising'
  } else if (recentPoints < priorPoints) {
    trajectory = 'falling'
  }

  return { level, score, trajectory }
}

/**
 * Register trust routes on a Hono router instance.
 */
export function registerTrustRoutes(api: Hono, db: Database.Database): void {
  // GET /api/v1/agents/:pubkey/trust
  api.get('/agents/:pubkey/trust', (c: Context) => {
    const agentPubkey = c.req.param('pubkey')
    const trust = getTrustLevel(db, agentPubkey)
    return c.json(trust)
  })
}
