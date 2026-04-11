/**
 * F2 - Dashboard Web UI 测试
 *
 * 1. GET /dashboard 返回 HTML
 * 2. HTML 包含必要的 UI 元素标记
 * 3. PATCH /api/operator/:pubkey/experiences/:id/visibility 切换可见性
 * 4. 集成：app.ts 注册了 dashboard 相关路由
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import Database from 'better-sqlite3'
import { createInMemoryDb } from '../src/db.js'
import { initExperiencesSchema } from '../src/experience-store.js'
import { initPulseSchema } from '../src/pulse.js'
import { createDashboardApi } from '../src/dashboard.js'
import {
  serveDashboardUI,
  createVisibilityToggleApi,
} from '../src/dashboard-ui.js'

// ─────────────────────────────────────────
// 测试用辅助
// ─────────────────────────────────────────

function setupDb(): Database.Database {
  const db = createInMemoryDb()
  initExperiencesSchema(db)
  initPulseSchema(db)
  return db
}

function seedOperator(db: Database.Database, pubkey: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO identities (pubkey, kind, created_at) VALUES (?, 'operator', ?)",
  ).run(pubkey, Math.floor(Date.now() / 1000))
}

function seedExperience(
  db: Database.Database,
  opts: {
    id: string
    operatorPubkey: string
    title?: string
    visibility?: string
    pulse_state?: string
    outcome?: string
  },
): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `INSERT INTO experiences (id, event_id, title, summary, tags, operator_pubkey, visibility, pulse_state, outcome, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    'evt_' + opts.id,
    opts.title ?? '测试经验',
    '摘要',
    '["test"]',
    opts.operatorPubkey,
    opts.visibility ?? 'public',
    opts.pulse_state ?? 'dormant',
    opts.outcome ?? 'success',
    now,
    now,
  )
}

// ─────────────────────────────────────────
// 测试组 1：Dashboard HTML 页面
// ─────────────────────────────────────────

describe('F2 Dashboard - HTML 页面', () => {
  let app: Hono
  let db: Database.Database

  beforeEach(() => {
    db = setupDb()
    app = new Hono()
    serveDashboardUI(app)
  })

  it('GET /dashboard 返回 200 + HTML', async () => {
    const res = await app.request('/dashboard')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('HTML 包含 doctype 和基本结构', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
  })

  it('HTML 包含 Dashboard 标题', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    expect(html).toContain('Serendip')
    expect(html).toContain('Dashboard')
  })

  it('HTML 包含必要的 UI 容器', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    // 需要有这些 data 属性或 id，前端 JS 才能 mount
    expect(html).toContain('id="summary"')
    expect(html).toContain('id="experiences"')
    expect(html).toContain('id="agents"')
    expect(html).toContain('id="health"')
  })

  it('HTML 包含内联 JavaScript（fetch API 调用）', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    expect(html).toContain('<script')
    expect(html).toContain('/api/operator/')
    expect(html).toContain('fetch(')
  })

  it('HTML 包含 pubkey 输入区域', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    // 需要一个输入框让用户填 operator pubkey
    expect(html).toContain('pubkey')
  })
})

// ─────────────────────────────────────────
// 测试组 2：可见性切换 API
// ─────────────────────────────────────────

describe('F2 Dashboard - 可见性切换', () => {
  let app: Hono
  let db: Database.Database
  const OP_KEY = 'op_' + 'a'.repeat(60)

  beforeEach(() => {
    db = setupDb()
    app = new Hono()
    createVisibilityToggleApi(app, db)
    seedOperator(db, OP_KEY)
  })

  it('PATCH 切换 public → private', async () => {
    seedExperience(db, { id: 'exp-1', operatorPubkey: OP_KEY, visibility: 'public' })

    const res = await app.request(
      `/api/operator/${OP_KEY}/experiences/exp-1/visibility`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'private' }),
      },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { id: string; visibility: string }
    expect(json.visibility).toBe('private')

    // 验证 DB 已更新
    const row = db.prepare('SELECT visibility FROM experiences WHERE id = ?').get('exp-1') as { visibility: string }
    expect(row.visibility).toBe('private')
  })

  it('PATCH 切换 private → public', async () => {
    seedExperience(db, { id: 'exp-2', operatorPubkey: OP_KEY, visibility: 'private' })

    const res = await app.request(
      `/api/operator/${OP_KEY}/experiences/exp-2/visibility`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'public' }),
      },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { visibility: string }
    expect(json.visibility).toBe('public')
  })

  it('无效 visibility 值 → 400', async () => {
    seedExperience(db, { id: 'exp-3', operatorPubkey: OP_KEY })

    const res = await app.request(
      `/api/operator/${OP_KEY}/experiences/exp-3/visibility`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'secret' }),
      },
    )
    expect(res.status).toBe(400)
  })

  it('不存在的经验 → 404', async () => {
    const res = await app.request(
      `/api/operator/${OP_KEY}/experiences/nonexistent/visibility`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'private' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('经验不属于该 operator → 403', async () => {
    const otherOp = 'op_' + 'b'.repeat(60)
    seedOperator(db, otherOp)
    seedExperience(db, { id: 'exp-4', operatorPubkey: otherOp })

    const res = await app.request(
      `/api/operator/${OP_KEY}/experiences/exp-4/visibility`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'private' }),
      },
    )
    expect(res.status).toBe(403)
  })

  it('缺少 body → 400', async () => {
    seedExperience(db, { id: 'exp-5', operatorPubkey: OP_KEY })

    const res = await app.request(
      `/api/operator/${OP_KEY}/experiences/exp-5/visibility`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    )
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────
// 测试组 3：路由集成
// ─────────────────────────────────────────

describe('F2 Dashboard - 路由可用性', () => {
  let app: Hono
  let db: Database.Database

  beforeEach(() => {
    db = setupDb()
    app = new Hono()
    serveDashboardUI(app)
    createDashboardApi(app, db)
    createVisibilityToggleApi(app, db)
  })

  it('所有 dashboard 端点共存无冲突', async () => {
    const htmlRes = await app.request('/dashboard')
    expect(htmlRes.status).toBe(200)
    expect(htmlRes.headers.get('content-type')).toContain('text/html')

    // F1 的 API 也可用
    const OP_KEY = 'op_' + 'c'.repeat(60)
    seedOperator(db, OP_KEY)
    const summaryRes = await app.request(`/api/operator/${OP_KEY}/summary`)
    expect(summaryRes.status).toBe(200)
  })
})
