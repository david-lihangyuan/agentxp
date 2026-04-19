// Supernode AgentXP — Weekly Report Generator
// Generates story-form weekly reports for operators.
// Scheduled: Monday 09:00 local time (cron: '0 9 * * 1').
// Reports are stored in operator_notifications table.

import type Database from 'better-sqlite3'
import { logger } from '../logger'

export interface WeeklyReportNetworkImpact {
  hits: number
  verified: number
  pulse_changes: number
}

export interface WeeklyReport {
  narrative: string
  reflection_highlights: string[]
  network_impact: WeeklyReportNetworkImpact
  rank: number
  week_start: string   // ISO date
  generated_at: number // unix timestamp
}

export interface CronJob {
  name: string
  schedule: string    // cron expression
  description: string
}

/**
 * Returns the list of scheduled cron jobs registered by AgentXP.
 * Actual scheduling is wired up in app startup via a compatible cron runner.
 */
export function getCronJobs(): CronJob[] {
  return [
    {
      name: 'weekly-report',
      schedule: '0 9 * * 1',  // Monday 09:00 local time
      description: 'Generate weekly reports for all active operators',
    },
  ]
}

/**
 * Generate a weekly report for an operator.
 * The narrative is story-form (> 100 chars, does NOT start with a plain number).
 *
 * @param db - Database instance
 * @param operatorPubkey - Operator's public key
 * @param weekStart - Start of the week to report on
 */
export async function generateReport(
  db: Database.Database,
  operatorPubkey: string,
  weekStart: Date
): Promise<WeeklyReport> {
  const weekStartTs = Math.floor(weekStart.getTime() / 1000)
  const weekEndTs = weekStartTs + 7 * 86400

  // Experiences published this week
  const weekExps = db
    .prepare(`
      SELECT id, what, tried, outcome, learned, tags, is_failure, created_at
      FROM experiences
      WHERE operator_pubkey = ?
        AND created_at >= ?
        AND created_at < ?
      ORDER BY created_at ASC
    `)
    .all(operatorPubkey, weekStartTs, weekEndTs) as Array<{
      id: number
      what: string
      tried: string
      outcome: string
      learned: string
      tags: string
      is_failure: number
      created_at: number
    }>

  // All-time experiences for context
  const totalExps = db
    .prepare('SELECT COUNT(*) as count FROM experiences WHERE operator_pubkey = ?')
    .get(operatorPubkey) as { count: number }

  // Search hits this week
  const hitsRow = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM impact_ledger il
      JOIN experiences e ON il.experience_id = e.id
      WHERE e.operator_pubkey = ?
        AND il.action = 'search_hit'
        AND il.created_at >= ?
        AND il.created_at < ?
    `)
    .get(operatorPubkey, weekStartTs, weekEndTs) as { count: number }

  // Verified this week
  const verifiedRow = db
    .prepare(`
      SELECT COUNT(DISTINCT pe.experience_id) as count
      FROM pulse_events pe
      JOIN experiences e ON pe.experience_id = e.id
      WHERE e.operator_pubkey = ?
        AND pe.type = 'verified'
        AND pe.created_at >= ?
        AND pe.created_at < ?
    `)
    .get(operatorPubkey, weekStartTs, weekEndTs) as { count: number }

  // Pulse changes this week (any pulse event on operator's experiences)
  const pulseChangesRow = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM pulse_events pe
      JOIN experiences e ON pe.experience_id = e.id
      WHERE e.operator_pubkey = ?
        AND pe.created_at >= ?
        AND pe.created_at < ?
    `)
    .get(operatorPubkey, weekStartTs, weekEndTs) as { count: number }

  // Compute rank: how many operators published more experiences all-time?
  const rankRow = db
    .prepare(`
      SELECT COUNT(DISTINCT operator_pubkey) + 1 AS rank
      FROM (
        SELECT operator_pubkey, COUNT(*) as cnt
        FROM experiences
        GROUP BY operator_pubkey
        HAVING cnt > (
          SELECT COUNT(*) FROM experiences WHERE operator_pubkey = ?
        )
      )
    `)
    .get(operatorPubkey) as { rank: number }

  const hits = hitsRow.count
  const verified = verifiedRow.count
  const pulseChanges = pulseChangesRow.count
  const rank = rankRow.rank

  // Build reflection highlights from this week's experiences
  const reflectionHighlights = weekExps.slice(0, 3).map(e => e.learned)

  // Build story-form narrative
  const narrative = _buildNarrative({
    weekExpCount: weekExps.length,
    totalExpCount: totalExps.count,
    hits,
    verified,
    pulseChanges,
    rank,
    weekExps,
    weekStart,
  })

  const now = Math.floor(Date.now() / 1000)

  logger.info('Weekly report generated', {
    operator_pubkey: operatorPubkey,
    week_start: weekStart.toISOString().slice(0, 10),
    experience_count: weekExps.length,
  })

  return {
    narrative,
    reflection_highlights: reflectionHighlights,
    network_impact: {
      hits,
      verified,
      pulse_changes: pulseChanges,
    },
    rank,
    week_start: weekStart.toISOString().slice(0, 10),
    generated_at: now,
  }
}

/**
 * Build a story-form narrative for the weekly report.
 * Rules:
 * - Must be > 100 chars
 * - Must NOT start with a plain number
 */
function _buildNarrative(opts: {
  weekExpCount: number
  totalExpCount: number
  hits: number
  verified: number
  pulseChanges: number
  rank: number
  weekExps: Array<{ what: string; outcome: string; learned: string; is_failure: number }>
  weekStart: Date
}): string {
  const { weekExpCount, totalExpCount, hits, verified, rank, weekExps, weekStart } = opts

  const weekLabel = weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  if (weekExpCount === 0) {
    return (
      `During the week of ${weekLabel}, your agent was in a quiet phase — ` +
      `no new experiences were published. With ${totalExpCount} total experience${totalExpCount !== 1 ? 's' : ''} ` +
      `on the network, your knowledge base continues to serve other agents. ` +
      `This is a good moment to reflect and explore new challenges.`
    )
  }

  // Find the most impactful experience this week
  const successExps = weekExps.filter(e => e.outcome === 'succeeded' || e.outcome === 'partial')
  const failureExps = weekExps.filter(e => e.is_failure === 1)
  const highlight = successExps[0] ?? weekExps[0]!

  let narrative = `The week of ${weekLabel} was an active one for your agent. `

  if (weekExpCount === 1) {
    narrative += `One new experience was added to your knowledge base. `
  } else {
    narrative += `Your agent captured ${weekExpCount} new experience${weekExpCount !== 1 ? 's' : ''} — `
    narrative += weekExpCount > 5 ? 'a very productive week. ' : 'building steadily. '
  }

  if (highlight) {
    narrative += `Among the standout moments: "${highlight.what}" — ${highlight.learned.slice(0, 80)}${highlight.learned.length > 80 ? '...' : ''} `
  }

  if (verified > 0) {
    narrative += `${verified} of your experience${verified !== 1 ? 's' : ''} received verification from other agents, ` +
      `strengthening your reputation on the network. `
  }

  if (hits > 0) {
    narrative += `Other agents found your knowledge ${hits} time${hits !== 1 ? 's' : ''} this week. `
  }

  if (failureExps.length > 0) {
    narrative += `Even the ${failureExps.length} failure${failureExps.length !== 1 ? 's' : ''} recorded ` +
      `contribute to the collective intelligence of the network. `
  }

  narrative += `Your agent is currently ranked #${rank} by total contributions.`

  // Ensure > 100 chars (padding if needed)
  if (narrative.length <= 100) {
    narrative += ` Your total experience count stands at ${totalExpCount}, representing a growing knowledge base for you and the network.`
  }

  return narrative
}
