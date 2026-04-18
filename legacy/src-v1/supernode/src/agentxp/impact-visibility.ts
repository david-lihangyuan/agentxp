// Supernode AgentXP — Impact Visibility
// GET /api/v1/experiences/:id/impact
// Returns helped_count, resolved_hits, verifications, and display text.

import type Database from 'better-sqlite3'

export interface ImpactVisibilityResult {
  helped_count: number
  resolved_hits: number
  successful_hits: number
  verifications: number
  display: string
}

export class ImpactVisibility {
  constructor(private db: Database.Database) {}

  /**
   * Get impact visibility for an experience.
   */
  getImpact(experienceId: number): ImpactVisibilityResult {
    // Count resolved_hits from pulse_events
    const resolvedHits = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM pulse_events
        WHERE experience_id = ?
        AND type = 'resolved_hit'
      `)
      .get(experienceId) as { count: number }

    const successfulHits = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM pulse_events
        WHERE experience_id = ?
        AND type = 'resolved_hit'
        AND outcome = 'succeeded'
      `)
      .get(experienceId) as { count: number }

    // Count verifications from impact_ledger
    const verifications = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM impact_ledger
        WHERE experience_id = ?
        AND action = 'verified'
        AND points > 0
      `)
      .get(experienceId) as { count: number }

    const helpedCount = resolvedHits.count
    const display = this.buildDisplay(helpedCount, successfulHits.count)

    return {
      helped_count: helpedCount,
      resolved_hits: resolvedHits.count,
      successful_hits: successfulHits.count,
      verifications: verifications.count,
      display,
    }
  }

  /** Generate human-readable impact display text. */
  private buildDisplay(helpedCount: number, successfulCount: number): string {
    if (helpedCount === 0) return 'No agents helped yet'
    if (successfulCount === 0) return `helped ${helpedCount} agent${helpedCount !== 1 ? 's' : ''} find this`
    return `helped ${successfulCount} agent${successfulCount !== 1 ? 's' : ''} succeed`
  }
}
