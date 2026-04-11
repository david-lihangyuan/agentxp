// Supernode — Identity Store
// Handles identity.register, identity.delegate, identity.revoke events.
// Pre-checks revocation before accepting any event.

import { Database } from 'bun:sqlite'
import type { SerendipEvent } from '@serendip/protocol'

export interface IdentityRecord {
  pubkey: string
  kind: 'operator' | 'agent'
  delegated_by: string | null
  expires_at: number | null
  revoked: number
  registered_at: number
  agent_id: string | null
}

export class IdentityStore {
  constructor(private db: Database) {}

  /** Check if a pubkey is revoked. Returns true if revoked. */
  isRevoked(pubkey: string): boolean {
    const row = this.db
      .query('SELECT revoked FROM identities WHERE pubkey = ?')
      .get(pubkey) as { revoked: number } | null
    return row?.revoked === 1
  }

  /** Check if a pubkey is expired. Returns true if expired. */
  isExpired(pubkey: string): boolean {
    const now = Math.floor(Date.now() / 1000)
    const row = this.db
      .query('SELECT expires_at FROM identities WHERE pubkey = ?')
      .get(pubkey) as { expires_at: number | null } | null
    if (!row) return false
    if (row.expires_at === null) return false
    return row.expires_at < now
  }

  /** Get an identity record. */
  get(pubkey: string): IdentityRecord | null {
    return this.db
      .query('SELECT * FROM identities WHERE pubkey = ?')
      .get(pubkey) as IdentityRecord | null
  }

  /** Handle identity.register event — register an operator. */
  handleRegister(event: SerendipEvent): { ok: boolean; error?: string } {
    // Only the operator signing this event can register themselves
    const pubkey = event.pubkey
    const now = Math.floor(Date.now() / 1000)

    // Idempotent: if already registered, just update last seen
    const existing = this.get(pubkey)
    if (existing) {
      if (existing.revoked) {
        return { ok: false, error: 'cannot re-register a revoked identity' }
      }
      return { ok: true } // Already registered, no-op
    }

    this.db
      .prepare(`
        INSERT INTO identities (pubkey, kind, delegated_by, expires_at, revoked, registered_at, agent_id)
        VALUES (?, 'operator', NULL, NULL, 0, ?, NULL)
      `)
      .run(pubkey, now)

    return { ok: true }
  }

  /** Handle identity.delegate event — register an agent sub-key. */
  handleDelegate(event: SerendipEvent): { ok: boolean; error?: string } {
    const operatorPubkey = event.pubkey
    const now = Math.floor(Date.now() / 1000)

    // Extract delegation data from payload
    const data = (event.payload?.data ?? {}) as Record<string, unknown>
    const agentPubkey = data['agentPubkey'] as string
    const expiresAt = data['expiresAt'] as number | undefined
    const agentId = data['agentId'] as string | undefined

    if (!agentPubkey || typeof agentPubkey !== 'string') {
      return { ok: false, error: 'missing agentPubkey in delegation payload' }
    }

    // Ensure operator is registered and not revoked
    const operator = this.get(operatorPubkey)
    if (!operator) {
      // Auto-register operator if not seen before
      this.db
        .prepare(`
          INSERT OR IGNORE INTO identities (pubkey, kind, delegated_by, expires_at, revoked, registered_at, agent_id)
          VALUES (?, 'operator', NULL, NULL, 0, ?, NULL)
        `)
        .run(operatorPubkey, now)
    } else if (operator.revoked) {
      return { ok: false, error: 'operator key is revoked' }
    }

    // Insert or update the agent
    this.db
      .prepare(`
        INSERT INTO identities (pubkey, kind, delegated_by, expires_at, revoked, registered_at, agent_id)
        VALUES (?, 'agent', ?, ?, 0, ?, ?)
        ON CONFLICT(pubkey) DO UPDATE SET
          delegated_by = excluded.delegated_by,
          expires_at = excluded.expires_at,
          revoked = 0,
          agent_id = excluded.agent_id
      `)
      .run(agentPubkey, operatorPubkey, expiresAt ?? null, now, agentId ?? null)

    return { ok: true }
  }

  /** Handle identity.revoke event — mark an agent sub-key as revoked. */
  handleRevoke(event: SerendipEvent): { ok: boolean; error?: string } {
    const operatorPubkey = event.pubkey
    const data = (event.payload?.data ?? {}) as Record<string, unknown>
    const revokedKey = data['revokedKey'] as string

    if (!revokedKey || typeof revokedKey !== 'string') {
      return { ok: false, error: 'missing revokedKey in revocation payload' }
    }

    // Ensure the agent belongs to this operator
    const agent = this.get(revokedKey)
    if (!agent) {
      return { ok: false, error: 'identity not found' }
    }

    if (agent.delegated_by !== operatorPubkey) {
      return { ok: false, error: 'can only revoke your own delegated agents' }
    }

    this.db
      .prepare('UPDATE identities SET revoked = 1 WHERE pubkey = ?')
      .run(revokedKey)

    return { ok: true }
  }

  /** Get all identity records for a given operator. */
  getAgentsForOperator(operatorPubkey: string): IdentityRecord[] {
    return this.db
      .query("SELECT * FROM identities WHERE delegated_by = ? AND kind = 'agent'")
      .all(operatorPubkey) as IdentityRecord[]
  }

  /** Get all agents (for bootstrap sync). */
  getAllAgents(): IdentityRecord[] {
    return this.db
      .query("SELECT * FROM identities WHERE kind = 'agent'")
      .all() as IdentityRecord[]
  }

  /** Get all identity events for relay bootstrap sync. */
  getAllIdentityEvents(db: Database): SerendipEvent[] {
    const rows = this.db
      .query("SELECT * FROM events WHERE kind IN ('identity.register', 'identity.delegate', 'identity.revoke') ORDER BY created_at ASC")
      .all() as Array<{
        id: string; pubkey: string; operator_pubkey: string; kind: string;
        created_at: number; payload: string; tags: string;
        visibility: string; sig: string
      }>

    return rows.map((r) => ({
      v: 1 as const,
      id: r.id,
      pubkey: r.pubkey,
      operator_pubkey: r.operator_pubkey,
      kind: r.kind as SerendipEvent['kind'],
      created_at: r.created_at,
      payload: JSON.parse(r.payload),
      tags: JSON.parse(r.tags),
      visibility: r.visibility as 'public' | 'private',
      sig: r.sig,
    }))
  }
}
