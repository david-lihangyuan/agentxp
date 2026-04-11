// Supernode AgentXP — Pulse State Machine
// Experience lifecycle: dormant → discovered → verified → propagating
// Transitions are logged to pulse_events table.
// Anti-gaming: same-operator search hits do not transition state.

import type Database from 'better-sqlite3'
import { logger } from '../logger'

export type PulseState = 'dormant' | 'discovered' | 'verified' | 'propagating'
export type PulseEventType =
  | 'discovered'
  | 'verified'
  | 'propagating'
  | 'resolved_hit'
  | 'subscription_match'

/** Valid state transitions. */
const VALID_TRANSITIONS: Record<PulseState, PulseState[]> = {
  dormant: ['discovered'],
  discovered: ['verified'],
  verified: ['propagating'],
  propagating: [],
}

export interface PulseRecord {
  id: number
  experience_id: number
  type: PulseEventType
  from_pubkey: string | null
  operator_pubkey: string | null
  metadata: string | null
  outcome: string | null
  created_at: number
}

export class PulseStateMachine {
  constructor(private db: Database.Database) {}

  /** Get the current pulse state for an experience. */
  getPulseState(experienceId: number): PulseState {
    // Current state is determined by the most recent state-transition event
    const event = this.db
      .prepare(`
        SELECT type FROM pulse_events
        WHERE experience_id = ?
        AND type IN ('discovered', 'verified', 'propagating')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `)
      .get(experienceId) as { type: PulseEventType } | undefined

    if (!event) return 'dormant'
    return event.type as PulseState
  }

  /**
   * Transition an experience to a new pulse state.
   * Logs the transition to pulse_events.
   * Returns { ok: false, error } if transition is invalid.
   */
  transitionPulse(
    experienceId: number,
    newState: PulseState,
    reason: string,
    options: {
      fromPubkey?: string
      operatorPubkey?: string
      metadata?: Record<string, unknown>
    } = {}
  ): { ok: boolean; error?: string } {
    if (newState === 'dormant') {
      return { ok: false, error: 'cannot transition to dormant' }
    }

    const currentState = this.getPulseState(experienceId)
    const allowed = VALID_TRANSITIONS[currentState]

    if (!allowed.includes(newState)) {
      return {
        ok: false,
        error: `invalid transition: ${currentState} → ${newState}`,
      }
    }

    try {
      const now = Math.floor(Date.now() / 1000)
      this.db
        .prepare(`
          INSERT INTO pulse_events
            (experience_id, type, from_pubkey, operator_pubkey, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          experienceId,
          newState,
          options.fromPubkey ?? null,
          options.operatorPubkey ?? null,
          options.metadata
            ? JSON.stringify({ ...options.metadata, reason })
            : JSON.stringify({ reason }),
          now
        )

      logger.info('Pulse transition', {
        experience_id: experienceId,
        from: currentState,
        to: newState,
        reason,
      })

      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Pulse transition failed', { experience_id: experienceId, error: msg })
      return { ok: false, error: msg }
    }
  }

  /**
   * Handle a search hit event.
   * If searcher is from a different operator, transition dormant → discovered.
   * Anti-gaming: same operator_pubkey = no transition.
   */
  handleSearchHit(
    experienceId: number,
    searcherPubkey: string,
    searcherOperatorPubkey: string
  ): void {
    const experience = this.db
      .prepare('SELECT operator_pubkey FROM experiences WHERE id = ?')
      .get(experienceId) as { operator_pubkey: string } | undefined

    if (!experience) return

    // Anti-gaming: same operator cannot trigger discovery transition
    if (experience.operator_pubkey === searcherOperatorPubkey) {
      logger.info('Search hit ignored (same operator)', {
        experience_id: experienceId,
        searcher_operator: searcherOperatorPubkey,
      })
      return
    }

    const currentState = this.getPulseState(experienceId)
    if (currentState === 'dormant') {
      this.transitionPulse(experienceId, 'discovered', 'cross-operator search hit', {
        fromPubkey: searcherPubkey,
        operatorPubkey: experience.operator_pubkey,
        metadata: { searcher_operator_pubkey: searcherOperatorPubkey },
      })
    }
  }

  /**
   * Record a resolved_hit pulse event when a searching agent reports task outcome.
   * Also triggers verified/propagating transitions when appropriate.
   */
  recordResolvedHit(
    experienceId: number,
    reporterPubkey: string,
    outcome: string,
    context?: Record<string, unknown>
  ): { ok: boolean; error?: string } {
    const experience = this.db
      .prepare('SELECT operator_pubkey FROM experiences WHERE id = ?')
      .get(experienceId) as { operator_pubkey: string } | undefined

    if (!experience) {
      return { ok: false, error: 'experience not found' }
    }

    try {
      const now = Math.floor(Date.now() / 1000)
      this.db
        .prepare(`
          INSERT INTO pulse_events
            (experience_id, type, from_pubkey, operator_pubkey, metadata, outcome, created_at)
          VALUES (?, 'resolved_hit', ?, ?, ?, ?, ?)
        `)
        .run(
          experienceId,
          reporterPubkey,
          experience.operator_pubkey,
          JSON.stringify({ context: context ?? {}, outcome }),
          outcome,
          now
        )

      logger.info('Resolved hit recorded', {
        experience_id: experienceId,
        reporter: reporterPubkey,
        outcome,
      })

      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
  }
}
