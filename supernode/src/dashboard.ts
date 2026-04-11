/**
 * F1 - Operator Dashboard 数据 API
 *
 * GET /api/operator/:pubkey/summary      — 总览统计
 * GET /api/operator/:pubkey/experiences  — 经验列表（带过滤/分页）
 * GET /api/operator/:pubkey/agents       — agent 列表（含活跃/过期/吊销状态）
 * GET /api/operator/:pubkey/health       — 网络健康度
 */
import type { Hono } from 'hono'
import type Database from 'better-sqlite3'

// ─────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────

export interface OperatorSummary {
  operator_pubkey: string
  total_experiences: number
  pulse_breakdown: Record<string, number>
  outcome_breakdown: Record<string, number>
  total_agents: number
  active_agents: number
  expired_agents: number
  revoked_agents: number
  total_events: number
  last_activity_at: number | null
}

export interface DashboardExperience {
  id: string
  title: string
  summary: string
  tags: string[]
  difficulty: string | null
  outcome: string | null
  pulse_state: string
  created_at: number
  updated_at: number
}

export interface DashboardAgent {
  pubkey: string
  status: 'active' | 'expired' | 'revoked'
  expires_at: number | null
  created_at: number
  experience_count: number
}

export interface NetworkHealth {
  operator_pubkey: string
  score: number                  // 0-100 综合健康分
  propagating_rate: number       // propagating / total（越高越好）
  verified_rate: number          // verified / total
  success_rate: number           // success / (success+failure+partial)
  active_agent_rate: number      // active / total agents
  total_experiences: number
  last_activity_at: number | null
  status: 'healthy' | 'degraded' | 'inactive'
}

// ─────────────────────────────────────────
// 数据查询函数
// ─────────────────────────────────────────

/**
 * 获取 operator 总览统计
 */
export function getOperatorSummary(
  db: Database.Database,
  operatorPubkey: string,
): OperatorSummary | null {
  // 检查 operator 是否存在
  const operator = db
    .prepare("SELECT pubkey FROM identities WHERE pubkey = ? AND kind = 'operator'")
    .get(operatorPubkey) as { pubkey: string } | undefined
  if (!operator) return null

  // 经验总数和 pulse 分布
  const expRows = db
    .prepare('SELECT pulse_state, outcome, COUNT(*) as cnt FROM experiences WHERE operator_pubkey = ? GROUP BY pulse_state, outcome')
    .all(operatorPubkey) as { pulse_state: string; outcome: string | null; cnt: number }[]

  const pulse_breakdown: Record<string, number> = {}
  const outcome_breakdown: Record<string, number> = {}
  let total_experiences = 0

  for (const row of expRows) {
    pulse_breakdown[row.pulse_state] = (pulse_breakdown[row.pulse_state] ?? 0) + row.cnt
    if (row.outcome) {
      outcome_breakdown[row.outcome] = (outcome_breakdown[row.outcome] ?? 0) + row.cnt
    }
    total_experiences += row.cnt
  }

  // agent 统计
  const agentRows = db
    .prepare('SELECT revoked, expires_at FROM identities WHERE delegated_by = ?')
    .all(operatorPubkey) as { revoked: number; expires_at: number | null }[]

  const now = Math.floor(Date.now() / 1000)
  let active_agents = 0, expired_agents = 0, revoked_agents = 0

  for (const a of agentRows) {
    if (a.revoked) {
      revoked_agents++
    } else if (a.expires_at !== null && a.expires_at < now) {
      expired_agents++
    } else {
      active_agents++
    }
  }

  // 事件总数
  const evtRow = db
    .prepare('SELECT COUNT(*) as cnt FROM events WHERE pubkey = ?')
    .get(operatorPubkey) as { cnt: number }
  const total_events = evtRow.cnt

  // 最后活动时间（经验维度）
  const lastRow = db
    .prepare('SELECT MAX(updated_at) as last_ts FROM experiences WHERE operator_pubkey = ?')
    .get(operatorPubkey) as { last_ts: number | null }

  return {
    operator_pubkey: operatorPubkey,
    total_experiences,
    pulse_breakdown,
    outcome_breakdown,
    total_agents: agentRows.length,
    active_agents,
    expired_agents,
    revoked_agents,
    total_events,
    last_activity_at: lastRow.last_ts,
  }
}

/**
 * 列出 operator 的经验（带过滤+分页）
 * 支持过滤：pulse_state, outcome, tag（单个）
 */
export function listDashboardExperiences(
  db: Database.Database,
  operatorPubkey: string,
  opts: {
    pulse_state?: string
    outcome?: string
    tag?: string
    limit?: number
    offset?: number
  } = {},
): { experiences: DashboardExperience[]; total: number } {
  const limit = Math.min(opts.limit ?? 20, 100)
  const offset = opts.offset ?? 0

  const conditions: string[] = ['operator_pubkey = ?']
  const params: unknown[] = [operatorPubkey]

  if (opts.pulse_state) {
    conditions.push('pulse_state = ?')
    params.push(opts.pulse_state)
  }
  if (opts.outcome) {
    conditions.push('outcome = ?')
    params.push(opts.outcome)
  }
  if (opts.tag) {
    // 简单 JSON 包含检查（SQLite 无数组函数，用 LIKE 近似）
    conditions.push("tags LIKE ?")
    params.push(`%"${opts.tag}"%`)
  }

  const where = conditions.join(' AND ')

  const totalRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM experiences WHERE ${where}`)
    .get(...params) as { cnt: number }

  const rows = db
    .prepare(`SELECT * FROM experiences WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[]

  const experiences = rows.map(rowToDashboardExp)
  return { experiences, total: totalRow.cnt }
}

/**
 * 列出 operator 下的 agents（含活跃状态+经验数）
 */
export function listDashboardAgents(
  db: Database.Database,
  operatorPubkey: string,
  includeRevoked = false,
): DashboardAgent[] {
  const sql = includeRevoked
    ? "SELECT * FROM identities WHERE delegated_by = ? ORDER BY created_at DESC"
    : "SELECT * FROM identities WHERE delegated_by = ? AND revoked = 0 ORDER BY created_at DESC"

  const rows = db.prepare(sql).all(operatorPubkey) as Record<string, unknown>[]
  const now = Math.floor(Date.now() / 1000)

  return rows.map(row => {
    const pubkey = row.pubkey as string
    const revoked = row.revoked === 1
    const expires_at = (row.expires_at ?? null) as number | null

    let status: 'active' | 'expired' | 'revoked'
    if (revoked) {
      status = 'revoked'
    } else if (expires_at !== null && expires_at < now) {
      status = 'expired'
    } else {
      status = 'active'
    }

    // 该 agent 发布的经验数
    const expCount = db
      .prepare('SELECT COUNT(*) as cnt FROM experiences WHERE operator_pubkey = ?')
      .get(pubkey) as { cnt: number }

    return {
      pubkey,
      status,
      expires_at,
      created_at: row.created_at as number,
      experience_count: expCount.cnt,
    }
  })
}

/**
 * 计算 operator 网络健康度（0-100 分）
 */
export function getNetworkHealth(
  db: Database.Database,
  operatorPubkey: string,
): NetworkHealth | null {
  const summary = getOperatorSummary(db, operatorPubkey)
  if (!summary) return null

  const total = summary.total_experiences

  // 没有任何经验 → inactive
  if (total === 0) {
    return {
      operator_pubkey: operatorPubkey,
      score: 0,
      propagating_rate: 0,
      verified_rate: 0,
      success_rate: 0,
      active_agent_rate: 0,
      total_experiences: 0,
      last_activity_at: null,
      status: 'inactive',
    }
  }

  const pb = summary.pulse_breakdown
  const ob = summary.outcome_breakdown

  // 各比率
  const propagating_rate = (pb['propagating'] ?? 0) / total
  const verified_rate = ((pb['verified'] ?? 0) + (pb['propagating'] ?? 0)) / total

  const outcome_total = (ob['success'] ?? 0) + (ob['failure'] ?? 0) + (ob['partial'] ?? 0)
  const success_rate = outcome_total > 0 ? (ob['success'] ?? 0) / outcome_total : 0

  const active_agent_rate = summary.total_agents > 0
    ? summary.active_agents / summary.total_agents
    : 1  // 没 agent 也算 1（solo operator）

  // 加权评分：
  //   propagating_rate ×30 + verified_rate ×25 + success_rate ×25 + active_agent_rate ×20
  const score = Math.round(
    propagating_rate * 30 +
    verified_rate * 25 +
    success_rate * 25 +
    active_agent_rate * 20,
  )

  const status: 'healthy' | 'degraded' | 'inactive' =
    score >= 60 ? 'healthy' : score >= 20 ? 'degraded' : 'inactive'

  return {
    operator_pubkey: operatorPubkey,
    score,
    propagating_rate,
    verified_rate,
    success_rate,
    active_agent_rate,
    total_experiences: total,
    last_activity_at: summary.last_activity_at,
    status,
  }
}

// ─────────────────────────────────────────
// Hono 路由注册
// ─────────────────────────────────────────

export function createDashboardApi(app: Hono, db: Database.Database): void {
  // 1. 总览
  app.get('/api/operator/:pubkey/summary', (c) => {
    const pubkey = c.req.param('pubkey')
    const summary = getOperatorSummary(db, pubkey)
    if (!summary) {
      return c.json({ error: `Operator not found: ${pubkey.slice(0, 8)}...` }, 404)
    }
    return c.json(summary, 200)
  })

  // 2. 经验列表
  app.get('/api/operator/:pubkey/experiences', (c) => {
    const pubkey = c.req.param('pubkey')

    // 先检查 operator 是否存在
    const op = db
      .prepare("SELECT pubkey FROM identities WHERE pubkey = ? AND kind = 'operator'")
      .get(pubkey) as { pubkey: string } | undefined
    if (!op) {
      return c.json({ error: `Operator not found: ${pubkey.slice(0, 8)}...` }, 404)
    }

    const pulse_state = c.req.query('pulse_state') || undefined
    const outcome = c.req.query('outcome') || undefined
    const tag = c.req.query('tag') || undefined
    const limit = parseInt(c.req.query('limit') ?? '20', 10)
    const offset = parseInt(c.req.query('offset') ?? '0', 10)

    const result = listDashboardExperiences(db, pubkey, { pulse_state, outcome, tag, limit, offset })
    return c.json(result, 200)
  })

  // 3. Agent 列表
  app.get('/api/operator/:pubkey/agents', (c) => {
    const pubkey = c.req.param('pubkey')

    const op = db
      .prepare("SELECT pubkey FROM identities WHERE pubkey = ? AND kind = 'operator'")
      .get(pubkey) as { pubkey: string } | undefined
    if (!op) {
      return c.json({ error: `Operator not found: ${pubkey.slice(0, 8)}...` }, 404)
    }

    const includeRevoked = c.req.query('include_revoked') === 'true'
    const agents = listDashboardAgents(db, pubkey, includeRevoked)
    return c.json({ agents, total: agents.length }, 200)
  })

  // 4. 网络健康度
  app.get('/api/operator/:pubkey/health', (c) => {
    const pubkey = c.req.param('pubkey')
    const health = getNetworkHealth(db, pubkey)
    if (!health) {
      return c.json({ error: `Operator not found: ${pubkey.slice(0, 8)}...` }, 404)
    }
    return c.json(health, 200)
  })
}

// ─────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────

function rowToDashboardExp(row: Record<string, unknown>): DashboardExperience {
  return {
    id: row.id as string,
    title: row.title as string,
    summary: row.summary as string,
    tags: (() => {
      try { return JSON.parse(row.tags as string) as string[] }
      catch { return [] }
    })(),
    difficulty: (row.difficulty ?? null) as string | null,
    outcome: (row.outcome ?? null) as string | null,
    pulse_state: row.pulse_state as string,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  }
}
