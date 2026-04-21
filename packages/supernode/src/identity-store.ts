// Identity view — derived from identity.register / identity.delegate /
// identity.revoke events. Per SPEC 02-data-model §5, §6.5.
import type { Db } from './db.js'

export interface IdentityRow {
  pubkey: string
  kind: 'operator' | 'agent'
  operator_pubkey: string | undefined
  delegated_at: number | undefined
  expires_at: number | undefined
  revoked: boolean
  registered_at: number
  agent_id: string | undefined
}

export function registerOperator(db: Db, pubkey: string, at: number): void {
  db.prepare(
    `INSERT INTO identities (pubkey, kind, registered_at, revoked)
     VALUES (?, 'operator', ?, 0)
     ON CONFLICT(pubkey) DO NOTHING`,
  ).run(pubkey, at)
}

export function delegateAgent(
  db: Db,
  agentPubkey: string,
  operatorPubkey: string,
  expiresAt: number,
  at: number,
  agentId: string | undefined,
): void {
  db.prepare(
    `INSERT INTO identities
       (pubkey, kind, operator_pubkey, delegated_at, expires_at, revoked, registered_at, agent_id)
     VALUES (?, 'agent', ?, ?, ?, 0, ?, ?)
     ON CONFLICT(pubkey) DO UPDATE SET
       operator_pubkey = excluded.operator_pubkey,
       delegated_at    = excluded.delegated_at,
       expires_at      = excluded.expires_at,
       revoked         = 0,
       agent_id        = excluded.agent_id`,
  ).run(agentPubkey, operatorPubkey, at, expiresAt, at, agentId ?? null)
}

export function revokeAgent(db: Db, agentPubkey: string, at: number): void {
  db.prepare(
    `UPDATE identities SET revoked = 1, revoked_at = ? WHERE pubkey = ?`,
  ).run(at, agentPubkey)
}

export function getIdentity(db: Db, pubkey: string): IdentityRow | null {
  const row = db
    .prepare(
      `SELECT pubkey, kind, operator_pubkey, delegated_at, expires_at, revoked,
              registered_at, agent_id
         FROM identities WHERE pubkey = ?`,
    )
    .get(pubkey) as
    | {
        pubkey: string
        kind: 'operator' | 'agent'
        operator_pubkey: string | null
        delegated_at: number | null
        expires_at: number | null
        revoked: number
        registered_at: number
        agent_id: string | null
      }
    | undefined
  if (!row) return null
  return {
    pubkey: row.pubkey,
    kind: row.kind,
    operator_pubkey: row.operator_pubkey === null ? undefined : row.operator_pubkey,
    delegated_at: row.delegated_at === null ? undefined : row.delegated_at,
    expires_at: row.expires_at === null ? undefined : row.expires_at,
    revoked: row.revoked === 1,
    registered_at: row.registered_at,
    agent_id: row.agent_id === null ? undefined : row.agent_id,
  }
}

/**
 * Check whether `agentPubkey` is a currently-valid delegation of
 * `operatorPubkey` at time `at`. Returns a reason code on failure so
 * callers can map to the correct HTTP status per SPEC 01-interfaces §3.
 */
export function checkDelegation(
  db: Db,
  agentPubkey: string,
  operatorPubkey: string,
  at: number,
):
  | { ok: true }
  | { ok: false; reason: 'unknown_agent' | 'not_delegated' | 'delegation_revoked' | 'delegation_expired' } {
  const row = getIdentity(db, agentPubkey)
  if (!row || row.kind !== 'agent') return { ok: false, reason: 'unknown_agent' }
  if (row.operator_pubkey !== operatorPubkey) return { ok: false, reason: 'not_delegated' }
  if (row.revoked) return { ok: false, reason: 'delegation_revoked' }
  if (row.expires_at !== undefined && row.expires_at < at) {
    return { ok: false, reason: 'delegation_expired' }
  }
  return { ok: true }
}
