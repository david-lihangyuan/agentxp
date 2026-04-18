/**
 * milestone-tracker.ts — Emotional milestones (§14.7)
 *
 * Four milestones:
 * - first_experience: first reflection written
 * - first_proactive_recall: first injection_log entry
 * - first_resolved_hit: first feedback with type='cited' AND target_type='network'
 * - day_30: 30 days after install
 *
 * Rules:
 * - Never more than one milestone per day (daily cap)
 * - Human, emotional messages (not product-copy)
 */

import type { Db } from '../db.js'

export interface MilestoneResult {
  type: string
  message: string
}

/**
 * Check for triggered milestones and insert into DB.
 * Returns newly triggered milestones (if any).
 * Daily cap: max 1 milestone per day.
 */
export async function checkMilestones(db: Db): Promise<MilestoneResult[]> {
  const milestones: MilestoneResult[] = []

  // Daily cap check: if a milestone was triggered today, skip all checks
  const today = new Date().toISOString().slice(0, 10)
  const todayMilestone = db.db.prepare(`
    SELECT 1 FROM milestones 
    WHERE date(triggered_at / 1000, 'unixepoch') = ? 
    LIMIT 1
  `).get(today)

  if (todayMilestone) {
    return [] // Already have a milestone today
  }

  // Get existing milestones
  const existing = db.db.prepare(`SELECT type FROM milestones`).all() as { type: string }[]
  const existingMilestones = new Set(existing.map(m => m.type))

  // Check first_experience (first reflection)
  if (!existingMilestones.has('first_experience')) {
    const firstReflection = db.db.prepare(`SELECT 1 FROM reflections LIMIT 1`).get()
    if (firstReflection) {
      milestones.push({
        type: 'first_experience',
        message: `Your first experience is in the network.
It will be here, helping Agents you'll never meet solve problems you might recognize.
That's how knowledge flows.`,
      })
    }
  }

  // Check first_proactive_recall (first injection_log entry)
  if (!existingMilestones.has('first_proactive_recall')) {
    const firstRecall = db.db.prepare(`SELECT 1 FROM injection_log LIMIT 1`).get()
    if (firstRecall) {
      milestones.push({
        type: 'first_proactive_recall',
        message: `Your Agent just avoided a mistake it made before.
It remembered on its own, before acting.
This is what reflection is for.`,
      })
    }
  }

  // Check first_resolved_hit (feedback with type='cited' AND target_type='network')
  if (!existingMilestones.has('first_resolved_hit')) {
    const resolvedHit = db.db.prepare(`
      SELECT 1 FROM feedback 
      WHERE type = 'cited' AND target_type = 'network' 
      LIMIT 1
    `).get()
    if (resolvedHit) {
      milestones.push({
        type: 'first_resolved_hit',
        message: `An Agent found your experience and succeeded because of it.
You helped someone you'll never know, with knowledge you almost didn't write down.`,
      })
    }
  }

  // Check day_30 (30 days after first reflection)
  if (!existingMilestones.has('day_30')) {
    const firstReflectionRow = db.db.prepare(`
      SELECT created_at FROM reflections 
      ORDER BY created_at ASC 
      LIMIT 1
    `).get() as { created_at: number } | undefined

    if (firstReflectionRow) {
      const daysElapsed = (Date.now() - firstReflectionRow.created_at) / (1000 * 60 * 60 * 24)
      if (daysElapsed >= 30) {
        const count = db.db.prepare(`SELECT COUNT(*) as count FROM reflections`).get() as { count: number }
        milestones.push({
          type: 'day_30',
          message: `30 days. Your Agent has written ${count.count} reflections.
One of them changed how it works.
You're building something together.`,
        })
      }
    }
  }

  // Insert first triggered milestone (daily cap = 1)
  const now = Date.now()
  if (milestones.length > 0) {
    const milestone = milestones[0] // Only insert the first one
    try {
      (db.insertMilestone as any).run(milestone.type, now, milestone.message)
      return [milestone]
    } catch (err) {
      // UNIQUE constraint violation — already inserted by another run
      return []
    }
  }

  return []
}
