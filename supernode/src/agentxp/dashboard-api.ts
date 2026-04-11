// Supernode AgentXP — Dashboard API
// Operator-facing dashboard endpoints:
//   GET /api/v1/dashboard/operator/:pubkey/summary
//   GET /api/v1/dashboard/operator/:pubkey/growth
//   GET /api/v1/dashboard/operator/:pubkey/failures
//   GET /api/v1/dashboard/operator/:pubkey/weekly-report
//   GET /api/v1/dashboard/experiences
//   GET /api/v1/dashboard/network

import type Database from 'better-sqlite3'
import { logger } from '../logger'

export interface OperatorSummary {
  agent_count: number
  experience_count: number
  verified_count: number
  search_hits: number
  reflection_streak: number
  top_lessons: string[]
}

export interface MonthlySummary {
  month: string      // e.g. "2026-04"
  published: number
  verified: number
  verification_rate: number
}

export interface Milestone {
  type: string  // 'first_experience' | 'first_verification' | 'first_resolved_hit' | 'day_30'
  date: string  // ISO date string
  display: string
}

export interface GrowthData {
  monthly: MonthlySummary[]
  milestones: Milestone[]
  current_verification_rate: number
}

export interface FailureImpact {
  failure_count: number
  helped_others_count: number
  display: string
}

export interface ExperienceListItem {
  id: number
  what: string
  tried: string
  outcome: string
  learned: string
  tags: string[]
  scope: Record<string, unknown> | null
  relations: Array<{ relation_type: string; direction: string; related_experience_id: number }>
  pulse_state: string
  created_at: number
}

export interface NetworkOverview {
  total_experiences: number
  total_agents: number
  verification_rate: number
  top_tags: Array<{ tag: string; count: number }>
  contributor_count: number
}

/**
 * DashboardAPI provides read-only analytics queries for the operator dashboard.
 */
export class DashboardAPI {
  constructor(private db: Database.Database) {}

  /**
   * Check if an operator pubkey is known (has any experiences).
   * Returns false if no experiences found for this operator.
   */
  operatorExists(operatorPubkey: string): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM experiences WHERE operator_pubkey = ?')
      .get(operatorPubkey) as { count: number }
    return row.count > 0
  }

  /**
   * GET /api/v1/dashboard/operator/:pubkey/summary
   * Returns high-level stats for an operator.
   */
  getOperatorSummary(operatorPubkey: string): OperatorSummary {
    // Count distinct agents that published experiences for this operator
    const agentRow = this.db
      .prepare('SELECT COUNT(DISTINCT pubkey) as count FROM experiences WHERE operator_pubkey = ?')
      .get(operatorPubkey) as { count: number }

    // Total experiences
    const expRow = this.db
      .prepare('SELECT COUNT(*) as count FROM experiences WHERE operator_pubkey = ?')
      .get(operatorPubkey) as { count: number }

    // Verified experiences (experiences that have a 'verified' pulse event)
    const verifiedRow = this.db
      .prepare(`
        SELECT COUNT(DISTINCT e.id) as count
        FROM experiences e
        JOIN pulse_events pe ON pe.experience_id = e.id AND pe.type = 'verified'
        WHERE e.operator_pubkey = ?
      `)
      .get(operatorPubkey) as { count: number }

    // Search hits (impact_ledger action='search_hit' for this operator's experiences)
    const searchHitsRow = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM impact_ledger il
        JOIN experiences e ON il.experience_id = e.id
        WHERE e.operator_pubkey = ? AND il.action = 'search_hit'
      `)
      .get(operatorPubkey) as { count: number }

    // Reflection streak: consecutive days with at least one published experience
    const streak = this._computeReflectionStreak(operatorPubkey)

    // Top lessons (what field of the top 5 most-verified experiences)
    const topLessonsRows = this.db
      .prepare(`
        SELECT e.learned, COUNT(pe.id) as hits
        FROM experiences e
        LEFT JOIN pulse_events pe ON pe.experience_id = e.id AND pe.type IN ('verified', 'resolved_hit')
        WHERE e.operator_pubkey = ?
        GROUP BY e.id
        ORDER BY hits DESC, e.created_at DESC
        LIMIT 5
      `)
      .all(operatorPubkey) as Array<{ learned: string; hits: number }>

    const topLessons = topLessonsRows.map(r => r.learned)

    return {
      agent_count: agentRow.count,
      experience_count: expRow.count,
      verified_count: verifiedRow.count,
      search_hits: searchHitsRow.count,
      reflection_streak: streak,
      top_lessons: topLessons,
    }
  }

  /**
   * GET /api/v1/dashboard/operator/:pubkey/growth
   * Returns monthly summaries, milestones, and current verification rate.
   */
  getOperatorGrowth(operatorPubkey: string): GrowthData {
    // Monthly summaries — group by YYYY-MM
    const monthlyRows = this.db
      .prepare(`
        SELECT
          strftime('%Y-%m', datetime(created_at, 'unixepoch')) AS month,
          COUNT(*) AS published,
          SUM(CASE WHEN id IN (
            SELECT DISTINCT experience_id FROM pulse_events WHERE type = 'verified'
          ) THEN 1 ELSE 0 END) AS verified
        FROM experiences
        WHERE operator_pubkey = ?
        GROUP BY month
        ORDER BY month ASC
      `)
      .all(operatorPubkey) as Array<{ month: string; published: number; verified: number }>

    const monthly: MonthlySummary[] = monthlyRows.map(r => ({
      month: r.month,
      published: r.published,
      verified: r.verified,
      verification_rate: r.published > 0 ? Math.round((r.verified / r.published) * 100) / 100 : 0,
    }))

    // Milestones — read from milestones table
    const milestoneRows = this.db
      .prepare('SELECT type, fired_at, metadata FROM milestones WHERE operator_pubkey = ? ORDER BY fired_at ASC')
      .all(operatorPubkey) as Array<{ type: string; fired_at: number; metadata: string | null }>

    // Auto-fire any milestones not yet recorded
    this._checkAndFireMilestones(operatorPubkey)

    // Re-read after potential auto-fire
    const updatedMilestoneRows = this.db
      .prepare('SELECT type, fired_at, metadata FROM milestones WHERE operator_pubkey = ? ORDER BY fired_at ASC')
      .all(operatorPubkey) as Array<{ type: string; fired_at: number; metadata: string | null }>

    const milestones: Milestone[] = updatedMilestoneRows.map(r => ({
      type: r.type,
      date: new Date(r.fired_at * 1000).toISOString().slice(0, 10),
      display: this._milestoneDisplay(r.type),
    }))

    // Current verification rate
    const totalExps = monthly.reduce((sum, m) => sum + m.published, 0)
    const totalVerified = monthly.reduce((sum, m) => sum + m.verified, 0)
    const currentVerificationRate = totalExps > 0 ? Math.round((totalVerified / totalExps) * 100) / 100 : 0

    return {
      monthly,
      milestones,
      current_verification_rate: currentVerificationRate,
    }
  }

  /**
   * GET /api/v1/dashboard/operator/:pubkey/failures
   * Returns failure count and how many of those helped other agents.
   */
  getFailureImpact(operatorPubkey: string): FailureImpact {
    const failureRow = this.db
      .prepare('SELECT COUNT(*) as count FROM experiences WHERE operator_pubkey = ? AND is_failure = 1')
      .get(operatorPubkey) as { count: number }

    // Failures that helped others = failure experiences with at least one resolved_hit
    const helpedRow = this.db
      .prepare(`
        SELECT COUNT(DISTINCT e.id) as count
        FROM experiences e
        JOIN pulse_events pe ON pe.experience_id = e.id AND pe.type = 'resolved_hit'
        WHERE e.operator_pubkey = ? AND e.is_failure = 1
      `)
      .get(operatorPubkey) as { count: number }

    const failureCount = failureRow.count
    const helpedCount = helpedRow.count
    const display = `Your failures helped ${helpedCount} agent${helpedCount !== 1 ? 's' : ''} avoid the same mistake`

    return {
      failure_count: failureCount,
      helped_others_count: helpedCount,
      display,
    }
  }

  /**
   * GET /api/v1/dashboard/experiences
   * Returns all experiences with scope, dialogue relations, and pulse state.
   */
  getExperienceList(): { experiences: ExperienceListItem[] } {
    const rows = this.db
      .prepare(`
        SELECT id, what, tried, outcome, learned, tags, scope, created_at
        FROM experiences
        ORDER BY created_at DESC
        LIMIT 200
      `)
      .all() as Array<{
        id: number
        what: string
        tried: string
        outcome: string
        learned: string
        tags: string
        scope: string | null
        created_at: number
      }>

    const experiences: ExperienceListItem[] = rows.map(row => {
      // Parse tags
      let tags: string[] = []
      try { tags = JSON.parse(row.tags) } catch { tags = [] }

      // Parse scope
      let scope: Record<string, unknown> | null = null
      if (row.scope) {
        try { scope = JSON.parse(row.scope) } catch { scope = null }
      }

      // Get dialogue relations
      const relationRows = this.db
        .prepare(`
          SELECT
            er.relation_type,
            'outgoing' AS direction,
            er.to_experience_id AS related_experience_id
          FROM experience_relations er
          WHERE er.from_experience_id = ?
          UNION ALL
          SELECT
            er.relation_type,
            'incoming' AS direction,
            er.from_experience_id AS related_experience_id
          FROM experience_relations er
          WHERE er.to_experience_id = ?
        `)
        .all(row.id, row.id) as Array<{
          relation_type: string
          direction: string
          related_experience_id: number
        }>

      // Get pulse state
      const pulseEvent = this.db
        .prepare(`
          SELECT type FROM pulse_events
          WHERE experience_id = ?
          AND type IN ('discovered', 'verified', 'propagating')
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `)
        .get(row.id) as { type: string } | undefined

      const pulseState = pulseEvent ? pulseEvent.type : 'dormant'

      return {
        id: row.id,
        what: row.what,
        tried: row.tried,
        outcome: row.outcome,
        learned: row.learned,
        tags,
        scope,
        relations: relationRows,
        pulse_state: pulseState,
        created_at: row.created_at,
      }
    })

    return { experiences }
  }

  /**
   * GET /api/v1/dashboard/network
   * Returns global network-level statistics.
   */
  getNetworkOverview(): NetworkOverview {
    const totalExpRow = this.db
      .prepare('SELECT COUNT(*) as count FROM experiences')
      .get() as { count: number }

    const totalAgentsRow = this.db
      .prepare('SELECT COUNT(DISTINCT pubkey) as count FROM experiences')
      .get() as { count: number }

    const totalVerifiedRow = this.db
      .prepare(`
        SELECT COUNT(DISTINCT experience_id) as count
        FROM pulse_events WHERE type = 'verified'
      `)
      .get() as { count: number }

    const total = totalExpRow.count
    const verificationRate = total > 0
      ? Math.round((totalVerifiedRow.count / total) * 100) / 100
      : 0

    // Top tags — flatten JSON arrays from experiences.tags
    const tagRows = this.db
      .prepare('SELECT tags FROM experiences')
      .all() as Array<{ tags: string }>

    const tagCounts: Record<string, number> = {}
    for (const row of tagRows) {
      try {
        const arr: string[] = JSON.parse(row.tags)
        for (const tag of arr) {
          tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
        }
      } catch { /* skip malformed */ }
    }

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }))

    const contributorRow = this.db
      .prepare('SELECT COUNT(DISTINCT operator_pubkey) as count FROM experiences')
      .get() as { count: number }

    return {
      total_experiences: total,
      total_agents: totalAgentsRow.count,
      verification_rate: verificationRate,
      top_tags: topTags,
      contributor_count: contributorRow.count,
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _computeReflectionStreak(operatorPubkey: string): number {
    // Get distinct days (YYYY-MM-DD) of experience creation
    const days = this.db
      .prepare(`
        SELECT DISTINCT strftime('%Y-%m-%d', datetime(created_at, 'unixepoch')) AS day
        FROM experiences
        WHERE operator_pubkey = ?
        ORDER BY day DESC
      `)
      .all(operatorPubkey) as Array<{ day: string }>

    if (days.length === 0) return 0

    let streak = 1
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(days[i - 1]!.day)
      const curr = new Date(days[i]!.day)
      const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86400000)
      if (diffDays === 1) {
        streak++
      } else {
        break
      }
    }
    return streak
  }

  private _checkAndFireMilestones(operatorPubkey: string): void {
    // first_experience
    const firstExp = this.db
      .prepare('SELECT created_at FROM experiences WHERE operator_pubkey = ? ORDER BY created_at ASC LIMIT 1')
      .get(operatorPubkey) as { created_at: number } | undefined

    if (firstExp) {
      this._fireMilestone(operatorPubkey, 'first_experience', firstExp.created_at)
    }

    // first_verification
    const firstVerified = this.db
      .prepare(`
        SELECT pe.created_at
        FROM pulse_events pe
        JOIN experiences e ON pe.experience_id = e.id
        WHERE e.operator_pubkey = ? AND pe.type = 'verified'
        ORDER BY pe.created_at ASC LIMIT 1
      `)
      .get(operatorPubkey) as { created_at: number } | undefined

    if (firstVerified) {
      this._fireMilestone(operatorPubkey, 'first_verification', firstVerified.created_at)
    }

    // first_resolved_hit
    const firstResolved = this.db
      .prepare(`
        SELECT pe.created_at
        FROM pulse_events pe
        JOIN experiences e ON pe.experience_id = e.id
        WHERE e.operator_pubkey = ? AND pe.type = 'resolved_hit'
        ORDER BY pe.created_at ASC LIMIT 1
      `)
      .get(operatorPubkey) as { created_at: number } | undefined

    if (firstResolved) {
      this._fireMilestone(operatorPubkey, 'first_resolved_hit', firstResolved.created_at)
    }

    // day_30: operator's first experience was >= 30 days ago
    if (firstExp) {
      const now = Math.floor(Date.now() / 1000)
      if (now - firstExp.created_at >= 30 * 86400) {
        // Fire day_30 milestone at 30 days after first experience
        this._fireMilestone(operatorPubkey, 'day_30', firstExp.created_at + 30 * 86400)
      }
    }
  }

  private _fireMilestone(operatorPubkey: string, type: string, firedAt: number): void {
    try {
      this.db
        .prepare('INSERT OR IGNORE INTO milestones (operator_pubkey, type, fired_at) VALUES (?, ?, ?)')
        .run(operatorPubkey, type, firedAt)
    } catch (err) {
      logger.error('Failed to fire milestone', { type, error: String(err) })
    }
  }

  private _milestoneDisplay(type: string): string {
    switch (type) {
      case 'first_experience': return 'Published your first experience!'
      case 'first_verification': return 'Your experience was verified by another agent!'
      case 'first_resolved_hit': return 'An agent resolved a search using your experience!'
      case 'day_30': return '30 days of contributing to the network!'
      default: return type
    }
  }
}
