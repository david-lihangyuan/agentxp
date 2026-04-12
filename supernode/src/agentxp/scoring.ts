// Supernode AgentXP — Impact Scoring
// Records points for actions on experiences.
// Anti-gaming: same-operator verifications give 0 points.
// Verifier diversity: cross-circle (different operator domain) weighted 3x.

import type Database from 'better-sqlite3'
import { logger } from '../logger'

export type ScoreAction = 'search_hit' | 'verified' | 'cited' | 'resolved_hit'

export interface ImpactScore {
  total: number
  breakdown: {
    search_hits: number
    verifications: number
    citations: number
  }
  diversity_score: number
  display: string
}

export interface DiversityInfo {
  operator_count: number
  domain_count: number
}

/** Points per action. */
const POINTS: Record<ScoreAction, number> = {
  search_hit: 1,
  verified: 5,
  cited: 10,
  resolved_hit: 5,
}

/** Daily search_hit cap per experience (across all actors). */
const DAILY_SEARCH_HIT_CAP = 5

/**
 * Extract a simple domain key from a pubkey.
 * We use the first 8 chars as a "domain" (operator identity cluster).
 * In production this would be mapped to DNS domain via delegation cert.
 * For now, we treat distinct operator_pubkeys as distinct domains for the test harness.
 */
function extractDomain(operatorPubkey: string): string {
  // Use first 16 chars as "domain" to group operators into rough clusters
  return operatorPubkey.slice(0, 16)
}

export class ImpactScoring {
  constructor(private db: Database.Database) {}

  /**
   * Record a scored action on an experience.
   * Returns points awarded (0 if anti-gaming rule applies).
   */
  score(
    experienceId: number,
    action: ScoreAction,
    actorPubkey: string,
    ownerOperatorPubkey: string,
    actorOperatorPubkey?: string
  ): { ok: boolean; points: number; reason?: string } {
    // Determine the operator for the actor
    const actorOp = actorOperatorPubkey ?? this.lookupOperator(actorPubkey) ?? actorPubkey

    // Anti-gaming: same-operator verified gives 0
    if (action === 'verified' && actorOp === ownerOperatorPubkey) {
      logger.info('Impact scoring: same-operator verification ignored (anti-gaming)', {
        experience_id: experienceId,
        actor_operator: actorOp,
        owner_operator: ownerOperatorPubkey,
      })
      return { ok: true, points: 0, reason: 'same-operator verification (anti-gaming)' }
    }

    // Anti-gaming: same-operator search hit gives 0
    if (action === 'search_hit' && actorOp === ownerOperatorPubkey) {
      logger.info('Impact scoring: same-operator search hit ignored (anti-gaming)', {
        experience_id: experienceId,
        actor_operator: actorOp,
        owner_operator: ownerOperatorPubkey,
      })
      return { ok: true, points: 0, reason: 'same-operator search_hit (anti-gaming)' }
    }

    // Daily cap for search_hits
    if (action === 'search_hit') {
      const todayStart = this.startOfTodayUtc()
      const todayHits = this.db
        .prepare(`
          SELECT COALESCE(SUM(points), 0) AS total
          FROM impact_ledger
          WHERE experience_id = ?
          AND action = 'search_hit'
          AND created_at >= ?
        `)
        .get(experienceId, todayStart) as { total: number }

      if (todayHits.total >= DAILY_SEARCH_HIT_CAP) {
        return { ok: true, points: 0, reason: 'daily search_hit cap reached' }
      }
    }

    const basePoints = POINTS[action]

    // Cross-circle diversity multiplier for verifications
    let points = basePoints
    if (action === 'verified') {
      const actorDomain = extractDomain(actorOp)
      const ownerDomain = extractDomain(ownerOperatorPubkey)
      if (actorDomain !== ownerDomain) {
        // Cross-circle: 3x weight
        points = basePoints * 3
      }
    }

    try {
      const now = Math.floor(Date.now() / 1000)
      this.db
        .prepare(`
          INSERT INTO impact_ledger
            (experience_id, actor_pubkey, action, points, created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(experienceId, actorPubkey, action, points, now)

      logger.info('Impact scored', {
        experience_id: experienceId,
        action,
        actor: actorPubkey.slice(0, 8),
        points,
      })

      return { ok: true, points }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Impact scoring failed', { experience_id: experienceId, error: msg })
      return { ok: false, points: 0, reason: msg }
    }
  }

  /**
   * Get aggregate impact score for an experience.
   */
  getScore(experienceId: number): ImpactScore {
    const rows = this.db
      .prepare(`
        SELECT action, SUM(points) AS total
        FROM impact_ledger
        WHERE experience_id = ?
        GROUP BY action
      `)
      .all(experienceId) as Array<{ action: string; total: number }>

    let search_hits = 0
    let verifications = 0
    let citations = 0
    let total = 0

    for (const row of rows) {
      total += row.total
      if (row.action === 'search_hit') search_hits = row.total
      else if (row.action === 'verified') verifications = row.total
      else if (row.action === 'cited') citations = row.total
    }

    const diversity = this.getVerifierDiversity(experienceId)
    const display = this.buildDisplayString(verifications, diversity)

    return {
      total,
      breakdown: { search_hits, verifications, citations },
      diversity_score: diversity.operator_count,
      display,
    }
  }

  /**
   * Get verifier diversity for an experience.
   */
  getVerifierDiversity(experienceId: number): DiversityInfo {
    const verifiers = this.db
      .prepare(`
        SELECT DISTINCT actor_pubkey
        FROM impact_ledger
        WHERE experience_id = ?
        AND action = 'verified'
      `)
      .all(experienceId) as Array<{ actor_pubkey: string }>

    const operatorPubkeys = new Set<string>()
    const domains = new Set<string>()

    for (const v of verifiers) {
      const op = this.lookupOperator(v.actor_pubkey) ?? v.actor_pubkey
      operatorPubkeys.add(op)
      domains.add(extractDomain(op))
    }

    return {
      operator_count: operatorPubkeys.size,
      domain_count: domains.size,
    }
  }

  /** Build human-readable display string. */
  private buildDisplayString(verifications: number, diversity: DiversityInfo): string {
    if (verifications === 0) return '0 verified'
    return `${Math.round(verifications / POINTS['verified'])} verified (${diversity.operator_count} operators, ${diversity.domain_count} domains)`
  }

  /** Look up operator pubkey for an agent pubkey. */
  private lookupOperator(agentPubkey: string): string | null {
    const identity = this.db
      .prepare('SELECT delegated_by FROM identities WHERE pubkey = ?')
      .get(agentPubkey) as { delegated_by: string | null } | undefined
    return identity?.delegated_by ?? null
  }

  /** Get start of today in UTC as Unix timestamp. */
  private startOfTodayUtc(): number {
    const now = new Date()
    now.setUTCHours(0, 0, 0, 0)
    return Math.floor(now.getTime() / 1000)
  }
}
