/**
 * scoring.ts — Impact scoring (§7.3)
 *
 * Scoring rules:
 * - search_hit: +1 (daily cap: +5 per reflection per day)
 * - verified: +5
 * - cited: +10 (with citation chain decay: L1=100%, L2=50%, L3=25%)
 *
 * Anti-gaming: No score earned through unilateral action (enforced by relay).
 * Local plugin simplification: no same-operator check (single-agent context).
 */

import type { Db } from '../db.js'

export interface FeedbackEvent {
  reflection_id: number
  type: 'search_hit' | 'verified' | 'cited'
  timestamp: number
  citation_depth?: number // For cited events: 1 = direct, 2+ = chain
}

export interface ScoreResult {
  reflection_id: number
  score: number
}

/**
 * Compute impact score from a list of feedback events.
 * Pure function (no DB access).
 */
export function computeImpactScore(events: FeedbackEvent[]): number {
  let score = 0
  const dailySearchHits = new Map<string, number>() // date -> count

  for (const event of events) {
    switch (event.type) {
      case 'search_hit': {
        const date = new Date(event.timestamp).toISOString().slice(0, 10)
        const hits = dailySearchHits.get(date) || 0
        if (hits < 5) {
          // Daily cap: +5 per day
          score += 1
          dailySearchHits.set(date, hits + 1)
        }
        break
      }

      case 'verified':
        score += 5
        break

      case 'cited': {
        // Citation chain decay: L1=100%, L2=50%, L3+=25%
        const depth = event.citation_depth || 1
        let multiplier = 1.0
        if (depth === 2) multiplier = 0.5
        else if (depth >= 3) multiplier = 0.25

        score += 10 * multiplier
        break
      }
    }
  }

  return score
}

/**
 * Process new feedback entries and update reflection scores.
 * Queries feedback table, computes scores, updates reflections.quality_score.
 */
export async function processNewFeedback(db: Db): Promise<ScoreResult[]> {
  const results: ScoreResult[] = []

  // Get all reflections with feedback
  const reflections = db.db.prepare(`
    SELECT DISTINCT target_id 
    FROM feedback 
    WHERE target_type = 'reflection'
  `).all() as { target_id: number }[]

  for (const { target_id: reflectionId } of reflections) {
    // Get all feedback events for this reflection
    const feedbackRows = db.db.prepare(`
      SELECT type, created_at 
      FROM feedback 
      WHERE target_id = ? AND target_type = 'reflection'
      ORDER BY created_at ASC
    `).all(reflectionId) as { type: string; created_at: number }[]

    // Map to FeedbackEvent format
    const events: FeedbackEvent[] = feedbackRows.map(row => ({
      reflection_id: reflectionId,
      type: row.type as 'search_hit' | 'verified' | 'cited',
      timestamp: row.created_at,
      // TODO: citation_depth tracking (requires relay integration)
      citation_depth: 1,
    }))

    // Compute score
    const score = computeImpactScore(events)

    // Update reflection
    db.db.prepare(`
      UPDATE reflections 
      SET quality_score = ? 
      WHERE id = ?
    `).run(score, reflectionId)

    results.push({ reflection_id: reflectionId, score })
  }

  return results
}
