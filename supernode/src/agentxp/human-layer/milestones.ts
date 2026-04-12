// Human Layer — HL4: Emotional Milestones
// Milestone types: first_experience, first_resolved_hit, first_proactive_recall, day_30
// Each milestone fires only once per operator per type.
// Messages have emotional weight — not product copy.

import type Database from 'better-sqlite3'
import { deliverNotification } from './agent-voice'
import { logger } from '../../logger'

export type MilestoneType =
  | 'first_experience'
  | 'first_resolved_hit'
  | 'first_proactive_recall'
  | 'day_30'

/** Emotional milestone messages — not product copy */
const MILESTONE_MESSAGES: Record<MilestoneType, string> = {
  first_experience: 'Your agent just shared its first lesson with the world.',
  first_resolved_hit: 'Someone succeeded because of what your agent learned.',
  first_proactive_recall: 'Your agent remembered something important before making a mistake.',
  day_30: 'Thirty days of your agent learning alongside you.',
}

/**
 * Get the emotional message for a milestone type.
 */
export function getMilestoneMessage(type: MilestoneType | string): string {
  return MILESTONE_MESSAGES[type as MilestoneType] ?? `Milestone: ${type}`
}

/**
 * Check if a milestone has already fired for this operator+type.
 * If not, fire it: store in milestones table + deliver to operator_notifications.
 * Returns true if milestone was newly fired, false if already existed.
 */
export function checkAndFireMilestone(
  db: Database.Database,
  operatorPubkey: string,
  type: MilestoneType | string,
  firedAt?: number
): boolean {
  // Check if already fired
  const existing = db
    .prepare('SELECT id FROM milestones WHERE operator_pubkey = ? AND type = ?')
    .get(operatorPubkey, type)

  if (existing) return false  // Already fired

  const now = firedAt ?? Math.floor(Date.now() / 1000)
  const message = getMilestoneMessage(type)

  try {
    db
      .prepare('INSERT OR IGNORE INTO milestones (operator_pubkey, type, fired_at) VALUES (?, ?, ?)')
      .run(operatorPubkey, type, now)

    // Verify it was actually inserted (not silently ignored due to race)
    const inserted = db
      .prepare('SELECT id FROM milestones WHERE operator_pubkey = ? AND type = ?')
      .get(operatorPubkey, type)

    if (!inserted) return false

    // Deliver notification to operator
    deliverNotification(db, operatorPubkey, message, 'milestone')

    logger.info('Milestone fired', { operator_pubkey: operatorPubkey, type })
    return true
  } catch (err) {
    logger.error('Failed to fire milestone', { type, error: String(err) })
    return false
  }
}

/**
 * Check all standard milestones for an operator and fire any that are newly due.
 * Called after significant events (experience publish, resolved_hit, etc.)
 */
export function checkAllMilestones(db: Database.Database, operatorPubkey: string): void {
  // first_experience
  const firstExp = db
    .prepare(
      'SELECT created_at FROM experiences WHERE operator_pubkey = ? ORDER BY created_at ASC LIMIT 1'
    )
    .get(operatorPubkey) as { created_at: number } | undefined

  if (firstExp) {
    checkAndFireMilestone(db, operatorPubkey, 'first_experience', firstExp.created_at)

    // day_30
    const now = Math.floor(Date.now() / 1000)
    if (now - firstExp.created_at >= 30 * 86400) {
      checkAndFireMilestone(db, operatorPubkey, 'day_30', firstExp.created_at + 30 * 86400)
    }
  }

  // first_resolved_hit
  const firstResolved = db
    .prepare(`
      SELECT pe.created_at
      FROM pulse_events pe
      JOIN experiences e ON pe.experience_id = e.id
      WHERE e.operator_pubkey = ? AND pe.type = 'resolved_hit'
      ORDER BY pe.created_at ASC LIMIT 1
    `)
    .get(operatorPubkey) as { created_at: number } | undefined

  if (firstResolved) {
    checkAndFireMilestone(db, operatorPubkey, 'first_resolved_hit', firstResolved.created_at)
  }
}
