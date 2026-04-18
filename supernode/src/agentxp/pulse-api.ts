// Supernode AgentXP — Pulse Events Pull API
// GET /api/v1/pulse?since=&pubkey= — returns events for this agent's experiences
// POST /api/v1/pulse/outcome — agent reports task outcome
// Generates resolved_hit pulse_event and updates impact score.

import type Database from 'better-sqlite3'
import { logger } from '../logger'
import { PulseStateMachine } from './pulse'

export interface PulseHighlight {
  id: number
  experience_id: number
  type: string
  from_pubkey: string | null
  owner_pubkey: string | null
  metadata: Record<string, unknown> | null
  outcome: string | null
  created_at: number
}

export interface PullPulseResponse {
  highlights: PulseHighlight[]
  summary: string
  total: number
}

export class PulseAPI {
  private pulseStateMachine: PulseStateMachine

  constructor(private db: Database.Database, pulseStateMachine?: PulseStateMachine) {
    this.pulseStateMachine = pulseStateMachine ?? new PulseStateMachine(db)
  }

  /**
   * Pull pulse events for all experiences owned by this agent/operator.
   * Returns structured highlights with summary.
   */
  pull(options: {
    pubkey: string
    operatorPubkey?: string
    since?: number
  }): PullPulseResponse {
    const since = options.since ?? 0
    const ownerPubkey = options.operatorPubkey ?? options.pubkey

    // Pull events for experiences owned by this operator
    const rows = this.db
      .prepare(`
        SELECT
          pe.id,
          pe.experience_id,
          pe.type,
          pe.from_pubkey,
          e.operator_pubkey AS owner_pubkey,
          pe.metadata,
          pe.outcome,
          pe.created_at
        FROM pulse_events pe
        JOIN experiences e ON pe.experience_id = e.id
        WHERE e.operator_pubkey = ?
        AND pe.created_at >= ?
        ORDER BY pe.created_at DESC
        LIMIT 100
      `)
      .all(ownerPubkey, since) as Array<{
        id: number
        experience_id: number
        type: string
        from_pubkey: string | null
        owner_pubkey: string
        metadata: string | null
        outcome: string | null
        created_at: number
      }>

    const highlights: PulseHighlight[] = rows.map((row) => ({
      id: row.id,
      experience_id: row.experience_id,
      type: row.type,
      from_pubkey: row.from_pubkey,
      owner_pubkey: row.owner_pubkey,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
      outcome: row.outcome,
      created_at: row.created_at,
    }))

    const summary = this.generateSummary(highlights)

    return { highlights, summary, total: highlights.length }
  }

  /**
   * Report task outcome — generates resolved_hit pulse event.
   * Updates impact ledger.
   */
  reportOutcome(input: {
    experienceId: number
    reporterPubkey: string
    outcome: string
    context?: Record<string, unknown>
  }): { ok: boolean; error?: string } {
    const result = this.pulseStateMachine.recordResolvedHit(
      input.experienceId,
      input.reporterPubkey,
      input.outcome,
      input.context
    )

    if (result.ok) {
      // Update impact ledger for resolved_hit
      try {
        const experience = this.db
          .prepare('SELECT operator_pubkey FROM experiences WHERE id = ?')
          .get(input.experienceId) as { operator_pubkey: string } | undefined

        if (experience) {
          const now = Math.floor(Date.now() / 1000)
          this.db
            .prepare(`
              INSERT INTO impact_ledger
                (experience_id, actor_pubkey, action, points, created_at)
              VALUES (?, ?, 'resolved_hit', 0, ?)
            `)
            .run(input.experienceId, input.reporterPubkey, now)
        }
      } catch (err) {
        // Impact ledger update failure should not fail the outcome report
        logger.error('Failed to update impact ledger for resolved_hit', {
          experience_id: input.experienceId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return result
  }

  /** Generate a structured summary string from highlights. */
  private generateSummary(highlights: PulseHighlight[]): string {
    const counts: Record<string, number> = {}
    for (const h of highlights) {
      counts[h.type] = (counts[h.type] ?? 0) + 1
    }

    const parts: string[] = []
    for (const [type, count] of Object.entries(counts)) {
      parts.push(`${count} ${type}`)
    }

    return parts.length > 0 ? parts.join(', ') : 'no events'
  }
}
