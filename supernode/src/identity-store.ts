/**
 * 身份注册与子密钥验证
 * B6: register / delegate / revoke / 吊销检查 / 过期检查
 */
import type Database from 'better-sqlite3'
import type { SerendipEvent } from '@serendip/protocol'

export interface Identity {
  pubkey: string
  kind: 'operator' | 'agent'
  delegated_by: string | null  // agent 才有，operator 为 null
  expires_at: number | null    // agent 才有，operator 为 null（永不过期）
  revoked: boolean
  created_at: number
}

export interface IdentityResult {
  ok: boolean
  error?: string
  pubkey?: string
}

export interface IdentityVerification {
  valid: boolean
  reason?: string  // 'not_found' | 'revoked' | 'expired' | 'operator_revoked'
  identity?: Identity
}

// ─────────────────────────────────────────
// 注册
// ─────────────────────────────────────────

/**
 * 注册 Operator 身份
 * - 要求 event.kind === 'identity.register'
 * - pubkey 即 event.pubkey
 * - 幂等：已存在不报错
 */
export function registerOperator(
  db: Database.Database,
  event: SerendipEvent,
): IdentityResult {
  if (event.kind !== 'identity.register') {
    return { ok: false, error: `Wrong event kind: expected 'identity.register', got '${event.kind}'` }
  }

  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO identities (pubkey, kind, delegated_by, expires_at, revoked, created_at)
      VALUES (?, 'operator', NULL, NULL, 0, ?)
    `)
    stmt.run(event.pubkey, event.created_at)
    return { ok: true, pubkey: event.pubkey }
  } catch (err) {
    return { ok: false, error: `Registration failed: ${String(err)}` }
  }
}

/**
 * 注册 Agent 子密钥（委托）
 * - 要求 event.kind === 'identity.delegate'
 * - content 必须包含 agent_pubkey, expires_at
 * - 必须由已注册且未吊销的 operator 发出
 */
export function delegateAgent(
  db: Database.Database,
  event: SerendipEvent,
): IdentityResult {
  if (event.kind !== 'identity.delegate') {
    return { ok: false, error: `Wrong event kind: expected 'identity.delegate', got '${event.kind}'` }
  }

  const content = event.content as Record<string, unknown>

  // 校验必填字段
  if (typeof content.agent_pubkey !== 'string' || content.agent_pubkey.length !== 64) {
    return { ok: false, error: 'Invalid content: agent_pubkey must be 64-char hex string' }
  }
  if (typeof content.expires_at !== 'number') {
    return { ok: false, error: 'Invalid content: expires_at is required (unix timestamp)' }
  }

  // 检查 operator 是否存在且有效
  const operatorCheck = verifyIdentity(db, event.pubkey)
  if (!operatorCheck.valid) {
    return {
      ok: false,
      error: `Operator ${event.pubkey.slice(0, 8)}... is not valid: ${operatorCheck.reason}`,
    }
  }
  if (operatorCheck.identity?.kind !== 'operator') {
    return {
      ok: false,
      error: `Pubkey ${event.pubkey.slice(0, 8)}... is not an operator (kind: ${operatorCheck.identity?.kind})`,
    }
  }

  const agentPubkey = content.agent_pubkey as string
  const expiresAt = content.expires_at as number

  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO identities (pubkey, kind, delegated_by, expires_at, revoked, created_at)
      VALUES (?, 'agent', ?, ?, 0, ?)
    `)
    stmt.run(agentPubkey, event.pubkey, expiresAt, event.created_at)
    return { ok: true, pubkey: agentPubkey }
  } catch (err) {
    return { ok: false, error: `Delegation failed: ${String(err)}` }
  }
}

/**
 * 吊销 Agent 子密钥
 * - 要求 event.kind === 'identity.revoke'
 * - 只有 agent 的 delegated_by operator 可以吊销
 * - 幂等：已吊销不报错
 */
export function revokeAgent(
  db: Database.Database,
  event: SerendipEvent,
): IdentityResult {
  if (event.kind !== 'identity.revoke') {
    return { ok: false, error: `Wrong event kind: expected 'identity.revoke', got '${event.kind}'` }
  }

  const content = event.content as Record<string, unknown>
  if (typeof content.agent_pubkey !== 'string') {
    return { ok: false, error: 'Invalid content: agent_pubkey is required' }
  }

  const agentPubkey = content.agent_pubkey as string

  // 查找 agent
  const agent = getIdentity(db, agentPubkey)
  if (!agent) {
    return { ok: false, error: `Agent ${agentPubkey.slice(0, 8)}... not found` }
  }

  if (agent.kind !== 'agent') {
    return { ok: false, error: `Cannot revoke an operator (use a different mechanism)` }
  }

  // 检查权限：只有签发方 operator 可以吊销
  if (agent.delegated_by !== event.pubkey) {
    return {
      ok: false,
      error: `Not authorized: ${event.pubkey.slice(0, 8)}... is not the delegating operator`,
    }
  }

  try {
    const stmt = db.prepare('UPDATE identities SET revoked = 1 WHERE pubkey = ?')
    stmt.run(agentPubkey)
    return { ok: true, pubkey: agentPubkey }
  } catch (err) {
    return { ok: false, error: `Revocation failed: ${String(err)}` }
  }
}

// ─────────────────────────────────────────
// 验证
// ─────────────────────────────────────────

/**
 * 验证一个 pubkey 是否当前有效
 * 检查：存在 → 未吊销 → 未过期 → (agent: operator 也未吊销)
 */
export function verifyIdentity(
  db: Database.Database,
  pubkey: string,
  now?: number,
): IdentityVerification {
  const identity = getIdentity(db, pubkey)
  if (!identity) {
    return { valid: false, reason: 'not_found' }
  }

  if (identity.revoked) {
    return { valid: false, reason: 'revoked', identity }
  }

  // 过期检查（只有 agent 有 expires_at）
  if (identity.expires_at !== null) {
    const currentTime = now ?? Math.floor(Date.now() / 1000)
    if (currentTime > identity.expires_at) {
      return { valid: false, reason: 'expired', identity }
    }
  }

  // 如果是 agent，还要检查其 operator 是否有效
  if (identity.kind === 'agent' && identity.delegated_by) {
    const operator = getIdentity(db, identity.delegated_by)
    if (!operator) {
      return { valid: false, reason: 'operator_revoked', identity }
    }
    if (operator.revoked) {
      return { valid: false, reason: 'operator_revoked', identity }
    }
  }

  return { valid: true, identity }
}

// ─────────────────────────────────────────
// 查询
// ─────────────────────────────────────────

/**
 * 获取单个身份
 */
export function getIdentity(
  db: Database.Database,
  pubkey: string,
): Identity | null {
  const row = db
    .prepare('SELECT * FROM identities WHERE pubkey = ?')
    .get(pubkey) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToIdentity(row)
}

/**
 * 列出某 operator 下的所有 agent
 */
export function listAgentsByOperator(
  db: Database.Database,
  operatorPubkey: string,
  includeRevoked = false,
): Identity[] {
  const sql = includeRevoked
    ? 'SELECT * FROM identities WHERE delegated_by = ? ORDER BY created_at DESC'
    : 'SELECT * FROM identities WHERE delegated_by = ? AND revoked = 0 ORDER BY created_at DESC'
  const rows = db.prepare(sql).all(operatorPubkey) as Record<string, unknown>[]
  return rows.map(rowToIdentity)
}

/**
 * 列出所有 operator
 */
export function listOperators(
  db: Database.Database,
  includeRevoked = false,
): Identity[] {
  const sql = includeRevoked
    ? "SELECT * FROM identities WHERE kind = 'operator' ORDER BY created_at DESC"
    : "SELECT * FROM identities WHERE kind = 'operator' AND revoked = 0 ORDER BY created_at DESC"
  const rows = db.prepare(sql).all() as Record<string, unknown>[]
  return rows.map(rowToIdentity)
}

// ─────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────

function rowToIdentity(row: Record<string, unknown>): Identity {
  return {
    pubkey: row.pubkey as string,
    kind: row.kind as 'operator' | 'agent',
    delegated_by: (row.delegated_by ?? null) as string | null,
    expires_at: (row.expires_at ?? null) as number | null,
    revoked: row.revoked === 1,
    created_at: row.created_at as number,
  }
}
