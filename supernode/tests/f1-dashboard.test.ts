/**
 * F1 - Dashboard 数据 API 测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb } from '../src/db.js'
import { initExperiencesSchema } from '../src/experience-store.js'
import type Database from 'better-sqlite3'
import {
  getOperatorSummary,
  listDashboardExperiences,
  listDashboardAgents,
  getNetworkHealth,
} from '../src/dashboard.js'
import { createApp } from '../src/app.js'
import { testClient } from 'hono/testing'
import { createDashboardApi } from '../src/dashboard.js'
import { initPulseSchema } from '../src/pulse.js'

// ─────────────────────────────────────────
// 工具函数：直接插入测试数据
// ─────────────────────────────────────────

function insertOperator(db: Database.Database, pubkey: string) {
  db.prepare(
    "INSERT OR IGNORE INTO identities (pubkey, kind, delegated_by, expires_at, revoked, created_at) VALUES (?, 'operator', NULL, NULL, 0, ?)"
  ).run(pubkey, Date.now())
}

function insertAgent(
  db: Database.Database,
  pubkey: string,
  operatorPubkey: string,
  opts: { revoked?: boolean; expires_at?: number } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    "INSERT OR IGNORE INTO identities (pubkey, kind, delegated_by, expires_at, revoked, created_at) VALUES (?, 'agent', ?, ?, ?, ?)"
  ).run(pubkey, operatorPubkey, opts.expires_at ?? now + 86400, opts.revoked ? 1 : 0, Date.now())
}

function insertExperience(
  db: Database.Database,
  id: string,
  operatorPubkey: string,
  opts: {
    pulse_state?: string
    outcome?: string
    tags?: string[]
    difficulty?: string
  } = {},
) {
  const now = Date.now()
  db.prepare(`
    INSERT OR IGNORE INTO experiences
      (id, event_id, operator_pubkey, title, summary, tags, difficulty, outcome, pulse_state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    `evt-${id}`,
    operatorPubkey,
    `Title ${id}`,
    `Summary of ${id}`,
    JSON.stringify(opts.tags ?? []),
    opts.difficulty ?? null,
    opts.outcome ?? null,
    opts.pulse_state ?? 'dormant',
    now,
    now,
  )
}

// ─────────────────────────────────────────
// 测试套件
// ─────────────────────────────────────────

describe('F1 Dashboard - getOperatorSummary', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
    initPulseSchema(db)
  })

  it('未知 operator 返回 null', () => {
    const result = getOperatorSummary(db, 'a'.repeat(64))
    expect(result).toBeNull()
  })

  it('已注册 operator，无经验，返回零计数', () => {
    const opKey = 'b'.repeat(64)
    insertOperator(db, opKey)
    const s = getOperatorSummary(db, opKey)
    expect(s).not.toBeNull()
    expect(s!.total_experiences).toBe(0)
    expect(s!.total_agents).toBe(0)
  })

  it('统计经验 pulse_breakdown', () => {
    const opKey = 'c'.repeat(64)
    insertOperator(db, opKey)
    insertExperience(db, 'e1', opKey, { pulse_state: 'dormant' })
    insertExperience(db, 'e2', opKey, { pulse_state: 'propagating' })
    insertExperience(db, 'e3', opKey, { pulse_state: 'propagating' })

    const s = getOperatorSummary(db, opKey)!
    expect(s.total_experiences).toBe(3)
    expect(s.pulse_breakdown['dormant']).toBe(1)
    expect(s.pulse_breakdown['propagating']).toBe(2)
  })

  it('统计 outcome_breakdown', () => {
    const opKey = 'd'.repeat(64)
    insertOperator(db, opKey)
    insertExperience(db, 'e4', opKey, { outcome: 'success' })
    insertExperience(db, 'e5', opKey, { outcome: 'failure' })
    insertExperience(db, 'e6', opKey, { outcome: 'success' })

    const s = getOperatorSummary(db, opKey)!
    expect(s.outcome_breakdown['success']).toBe(2)
    expect(s.outcome_breakdown['failure']).toBe(1)
  })

  it('统计 agent 活跃/过期/吊销数量', () => {
    const opKey = 'e'.repeat(64)
    insertOperator(db, opKey)
    const now = Math.floor(Date.now() / 1000)
    insertAgent(db, 'a'.repeat(64), opKey)                                    // active
    insertAgent(db, 'b'.repeat(64), opKey, { revoked: true })                 // revoked
    insertAgent(db, 'cc'.repeat(32), opKey, { expires_at: now - 1 })         // expired

    const s = getOperatorSummary(db, opKey)!
    expect(s.total_agents).toBe(3)
    expect(s.active_agents).toBe(1)
    expect(s.revoked_agents).toBe(1)
    expect(s.expired_agents).toBe(1)
  })
})

describe('F1 Dashboard - listDashboardExperiences', () => {
  let db: Database.Database
  const opKey = 'f'.repeat(64)

  beforeEach(() => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
    initPulseSchema(db)
    insertOperator(db, opKey)
    insertExperience(db, 'x1', opKey, { pulse_state: 'dormant', outcome: 'success', tags: ['node', 'debug'] })
    insertExperience(db, 'x2', opKey, { pulse_state: 'propagating', outcome: 'failure', tags: ['python'] })
    insertExperience(db, 'x3', opKey, { pulse_state: 'propagating', outcome: 'success', tags: ['node'] })
  })

  it('无过滤返回所有经验', () => {
    const { experiences, total } = listDashboardExperiences(db, opKey)
    expect(total).toBe(3)
    expect(experiences).toHaveLength(3)
  })

  it('按 pulse_state 过滤', () => {
    const { experiences, total } = listDashboardExperiences(db, opKey, { pulse_state: 'propagating' })
    expect(total).toBe(2)
    expect(experiences.every(e => e.pulse_state === 'propagating')).toBe(true)
  })

  it('按 outcome 过滤', () => {
    const { experiences, total } = listDashboardExperiences(db, opKey, { outcome: 'success' })
    expect(total).toBe(2)
    expect(experiences.every(e => e.outcome === 'success')).toBe(true)
  })

  it('按 tag 过滤', () => {
    const { experiences, total } = listDashboardExperiences(db, opKey, { tag: 'node' })
    expect(total).toBe(2)
  })

  it('分页 limit + offset', () => {
    const page1 = listDashboardExperiences(db, opKey, { limit: 2, offset: 0 })
    const page2 = listDashboardExperiences(db, opKey, { limit: 2, offset: 2 })
    expect(page1.experiences).toHaveLength(2)
    expect(page2.experiences).toHaveLength(1)
    expect(page1.total).toBe(3)
  })

  it('返回字段完整', () => {
    const { experiences } = listDashboardExperiences(db, opKey, { limit: 1 })
    const e = experiences[0]
    expect(e).toHaveProperty('id')
    expect(e).toHaveProperty('title')
    expect(e).toHaveProperty('summary')
    expect(Array.isArray(e.tags)).toBe(true)
    expect(e).toHaveProperty('pulse_state')
    expect(e).toHaveProperty('created_at')
  })
})

describe('F1 Dashboard - listDashboardAgents', () => {
  let db: Database.Database
  const opKey = '1'.repeat(64)

  beforeEach(() => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
    initPulseSchema(db)
    insertOperator(db, opKey)
    const now = Math.floor(Date.now() / 1000)
    insertAgent(db, '2'.repeat(64), opKey)                               // active
    insertAgent(db, '3'.repeat(64), opKey, { revoked: true })            // revoked
    insertAgent(db, '44'.repeat(32), opKey, { expires_at: now - 1 })    // expired
  })

  it('默认不包含已吊销', () => {
    const agents = listDashboardAgents(db, opKey, false)
    expect(agents.find(a => a.status === 'revoked')).toBeUndefined()
    expect(agents).toHaveLength(2) // active + expired
  })

  it('include_revoked=true 包含全部', () => {
    const agents = listDashboardAgents(db, opKey, true)
    expect(agents).toHaveLength(3)
  })

  it('状态分类正确', () => {
    const agents = listDashboardAgents(db, opKey, true)
    const byStatus = Object.fromEntries(agents.map(a => [a.pubkey.slice(0, 2), a.status]))
    expect(byStatus['22']).toBe('active')
    expect(byStatus['33']).toBe('revoked')
    expect(byStatus['44']).toBe('expired')
  })

  it('包含 experience_count 字段', () => {
    const agents = listDashboardAgents(db, opKey)
    agents.forEach(a => expect(a).toHaveProperty('experience_count'))
  })
})

describe('F1 Dashboard - getNetworkHealth', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
    initPulseSchema(db)
  })

  it('未知 operator 返回 null', () => {
    expect(getNetworkHealth(db, 'z'.repeat(64))).toBeNull()
  })

  it('零经验 → score=0, status=inactive', () => {
    const opKey = 'a1'.repeat(32)
    insertOperator(db, opKey)
    const h = getNetworkHealth(db, opKey)!
    expect(h.score).toBe(0)
    expect(h.status).toBe('inactive')
  })

  it('全部 propagating + success → 高分 + healthy', () => {
    const opKey = 'b2'.repeat(32)
    insertOperator(db, opKey)
    for (let i = 0; i < 5; i++) {
      insertExperience(db, `ph${i}`, opKey, { pulse_state: 'propagating', outcome: 'success' })
    }
    const h = getNetworkHealth(db, opKey)!
    // propagating_rate=1 → 30, verified_rate=1 → 25, success_rate=1 → 25, active_agent_rate=1 → 20 = 100
    expect(h.score).toBe(100)
    expect(h.status).toBe('healthy')
    expect(h.propagating_rate).toBe(1)
    expect(h.success_rate).toBe(1)
  })

  it('全部 dormant → 低分（degraded 或 inactive）', () => {
    const opKey = 'c3'.repeat(32)
    insertOperator(db, opKey)
    insertExperience(db, 'low1', opKey, { pulse_state: 'dormant' })
    const h = getNetworkHealth(db, opKey)!
    // 全部 dormant：propagating_rate=0, verified_rate=0, success_rate=0
    // active_agent_rate=1（solo operator 无 agent 默认 1）→ 得分 = 0+0+0+20 = 20 → degraded
    expect(h.score).toBeLessThan(30)
    expect(['degraded', 'inactive']).toContain(h.status)
  })

  it('混合状态 → 分数在中间', () => {
    const opKey = 'd4'.repeat(32)
    insertOperator(db, opKey)
    insertExperience(db, 'm1', opKey, { pulse_state: 'propagating', outcome: 'success' })
    insertExperience(db, 'm2', opKey, { pulse_state: 'dormant', outcome: 'failure' })
    const h = getNetworkHealth(db, opKey)!
    expect(h.score).toBeGreaterThan(0)
    expect(h.score).toBeLessThan(100)
  })

  it('返回字段完整', () => {
    const opKey = 'e5'.repeat(32)
    insertOperator(db, opKey)
    insertExperience(db, 'fld1', opKey)
    const h = getNetworkHealth(db, opKey)!
    expect(h).toHaveProperty('operator_pubkey')
    expect(h).toHaveProperty('score')
    expect(h).toHaveProperty('propagating_rate')
    expect(h).toHaveProperty('verified_rate')
    expect(h).toHaveProperty('success_rate')
    expect(h).toHaveProperty('active_agent_rate')
    expect(h).toHaveProperty('status')
  })
})

describe('F1 Dashboard - HTTP 路由', () => {
  let db: Database.Database
  const opKey = 'route'.repeat(12) + '0000'

  beforeEach(() => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
    initPulseSchema(db)
  })

  function buildApp() {
    const app = createApp(db)
    createDashboardApi(app, db)
    return app
  }

  it('GET /api/operator/:pubkey/summary - 404 for unknown', async () => {
    const app = buildApp()
    const res = await app.request(`/api/operator/${'z'.repeat(64)}/summary`)
    expect(res.status).toBe(404)
  })

  it('GET /api/operator/:pubkey/summary - 200 for known', async () => {
    insertOperator(db, opKey)
    const app = buildApp()
    const res = await app.request(`/api/operator/${opKey}/summary`)
    expect(res.status).toBe(200)
    const body = await res.json() as OperatorSummaryBody
    expect(body.operator_pubkey).toBe(opKey)
    expect(body).toHaveProperty('total_experiences')
  })

  it('GET /api/operator/:pubkey/experiences - 带过滤参数', async () => {
    insertOperator(db, opKey)
    insertExperience(db, 'hr1', opKey, { pulse_state: 'propagating' })
    insertExperience(db, 'hr2', opKey, { pulse_state: 'dormant' })
    const app = buildApp()
    const res = await app.request(`/api/operator/${opKey}/experiences?pulse_state=propagating`)
    expect(res.status).toBe(200)
    const body = await res.json() as { total: number }
    expect(body.total).toBe(1)
  })

  it('GET /api/operator/:pubkey/agents - 默认不含吊销', async () => {
    insertOperator(db, opKey)
    insertAgent(db, 'agent1'.padEnd(64, '0'), opKey)
    insertAgent(db, 'agent2'.padEnd(64, '0'), opKey, { revoked: true })
    const app = buildApp()
    const res = await app.request(`/api/operator/${opKey}/agents`)
    expect(res.status).toBe(200)
    const body = await res.json() as { total: number }
    expect(body.total).toBe(1)
  })

  it('GET /api/operator/:pubkey/agents?include_revoked=true', async () => {
    insertOperator(db, opKey)
    insertAgent(db, 'agent3'.padEnd(64, '0'), opKey)
    insertAgent(db, 'agent4'.padEnd(64, '0'), opKey, { revoked: true })
    const app = buildApp()
    const res = await app.request(`/api/operator/${opKey}/agents?include_revoked=true`)
    expect(res.status).toBe(200)
    const body = await res.json() as { total: number }
    expect(body.total).toBe(2)
  })

  it('GET /api/operator/:pubkey/health - 返回健康度', async () => {
    insertOperator(db, opKey)
    insertExperience(db, 'ht1', opKey, { pulse_state: 'propagating', outcome: 'success' })
    const app = buildApp()
    const res = await app.request(`/api/operator/${opKey}/health`)
    expect(res.status).toBe(200)
    const body = await res.json() as { score: number; status: string }
    expect(typeof body.score).toBe('number')
    expect(['healthy', 'degraded', 'inactive']).toContain(body.status)
  })
})

// 类型辅助
interface OperatorSummaryBody {
  operator_pubkey: string
  total_experiences: number
}
