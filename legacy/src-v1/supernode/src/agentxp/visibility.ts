// Supernode AgentXP — Three-Layer Visibility Manager
// Priority: experience-level > agent-level > operator-level > auto-classification
// Stores operator and agent visibility defaults in the DB.

import type Database from 'better-sqlite3'

export type VisibilityValue = 'public' | 'private'

export class VisibilityManager {
  constructor(private db: Database.Database) {}

  /**
   * Set operator-level default visibility.
   */
  setOperatorVisibility(operatorPubkey: string, visibility: VisibilityValue): void {
    const now = Math.floor(Date.now() / 1000)
    this.db
      .prepare(`
        INSERT INTO operator_visibility (operator_pubkey, default_visibility, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(operator_pubkey) DO UPDATE SET default_visibility = excluded.default_visibility, updated_at = excluded.updated_at
      `)
      .run(operatorPubkey, visibility, now)
  }

  /**
   * Set agent-level default visibility.
   */
  setAgentVisibility(agentPubkey: string, visibility: VisibilityValue): void {
    const now = Math.floor(Date.now() / 1000)
    this.db
      .prepare(`
        INSERT INTO agent_visibility (agent_pubkey, default_visibility, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(agent_pubkey) DO UPDATE SET default_visibility = excluded.default_visibility, updated_at = excluded.updated_at
      `)
      .run(agentPubkey, visibility, now)
  }

  /**
   * Resolve effective visibility for an experience.
   * Priority: experience-level > agent-level > operator-level > fallback.
   */
  resolveVisibility(
    experienceLevelVisibility: string | null | undefined,
    agentPubkey: string,
    operatorPubkey: string,
    fallback: VisibilityValue = 'public'
  ): VisibilityValue {
    // Experience-level overrides everything
    if (experienceLevelVisibility === 'public' || experienceLevelVisibility === 'private') {
      return experienceLevelVisibility
    }

    // Agent-level override
    const agentVis = this.db
      .prepare('SELECT default_visibility FROM agent_visibility WHERE agent_pubkey = ?')
      .get(agentPubkey) as { default_visibility: VisibilityValue } | undefined
    if (agentVis) {
      return agentVis.default_visibility
    }

    // Operator-level override
    const opVis = this.db
      .prepare('SELECT default_visibility FROM operator_visibility WHERE operator_pubkey = ?')
      .get(operatorPubkey) as { default_visibility: VisibilityValue } | undefined
    if (opVis) {
      return opVis.default_visibility
    }

    return fallback
  }

  getOperatorVisibility(operatorPubkey: string): VisibilityValue | null {
    const row = this.db
      .prepare('SELECT default_visibility FROM operator_visibility WHERE operator_pubkey = ?')
      .get(operatorPubkey) as { default_visibility: VisibilityValue } | undefined
    return row?.default_visibility ?? null
  }

  getAgentVisibility(agentPubkey: string): VisibilityValue | null {
    const row = this.db
      .prepare('SELECT default_visibility FROM agent_visibility WHERE agent_pubkey = ?')
      .get(agentPubkey) as { default_visibility: VisibilityValue } | undefined
    return row?.default_visibility ?? null
  }
}
