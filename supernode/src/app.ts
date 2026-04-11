import { Hono } from 'hono'
import { healthHandler } from './health.js'
import { handleEvent, getEvent } from './event-handler.js'
import { registerNode, heartbeatNode, getActiveNodes, getNode, initNodeRegistry } from './node-registry.js'
import { getExperiencesForSync, getSyncStats, initSyncSchema } from './experience-sync.js'
import { createDashboardApi } from './dashboard.js'
import { createVisibilityToggleApi, serveDashboardUI } from './dashboard-ui.js'
import type Database from 'better-sqlite3'

export function createApp(db?: Database.Database): Hono {
  const app = new Hono()

  // Health check
  app.get('/health', (c) => healthHandler(c))

  // HTTP REST 兼容层：POST /api/events
  if (db) {
    app.post('/api/events', async (c) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ ok: false, error: 'Invalid JSON body' }, 400)
      }

      const result = await handleEvent(db, body)
      if (!result.ok) {
        return c.json(result, 400)
      }
      return c.json(result, 201)
    })

    // GET /api/events/:id
    app.get('/api/events/:id', (c) => {
      const id = c.req.param('id')
      const event = getEvent(db, id)
      if (!event) {
        return c.json({ error: 'Event not found' }, 404)
      }
      return c.json(event, 200)
    })

    // ── Phase 2G：节点注册与发现 ─────────────────────────────

    // 初始化节点注册表和同步 schema
    initNodeRegistry(db)
    initSyncSchema(db)

    // POST /nodes/register — 节点注册
    app.post('/nodes/register', async (c) => {
      let body: Record<string, unknown>
      try {
        body = await c.req.json() as Record<string, unknown>
      } catch {
        return c.json({ ok: false, error: 'Invalid JSON body' }, 400)
      }

      const { nodeId, url, pubkey, version, capabilities } = body as {
        nodeId?: string; url?: string; pubkey?: string;
        version?: string; capabilities?: string[]
      }
      if (!nodeId || !url || !pubkey) {
        return c.json({ ok: false, error: 'nodeId, url, pubkey are required' }, 400)
      }

      try {
        const node = registerNode(db, { nodeId, url, pubkey, version, capabilities })
        return c.json({ ok: true, node }, 201)
      } catch (err) {
        return c.json({ ok: false, error: String(err) }, 400)
      }
    })

    // POST /nodes/:nodeId/heartbeat — 节点心跳
    app.post('/nodes/:nodeId/heartbeat', (c) => {
      const nodeId = c.req.param('nodeId')
      const ok = heartbeatNode(db, nodeId)
      if (!ok) {
        return c.json({ ok: false, error: 'Node not found' }, 404)
      }
      return c.json({ ok: true }, 200)
    })

    // GET /nodes — 活跃节点列表
    app.get('/nodes', (c) => {
      const nodes = getActiveNodes(db)
      return c.json({ nodes, count: nodes.length }, 200)
    })

    // GET /nodes/:nodeId — 单个节点详情
    app.get('/nodes/:nodeId', (c) => {
      const nodeId = c.req.param('nodeId')
      const node = getNode(db, nodeId)
      if (!node) {
        return c.json({ error: 'Node not found' }, 404)
      }
      return c.json(node, 200)
    })

    // ── Phase 2G：经验同步 ──────────────────────────────────

    // GET /sync?since=&limit= — 其他节点拉取本地经验
    app.get('/sync', (c) => {
      const since = Number(c.req.query('since') ?? '0')
      const limit = Number(c.req.query('limit') ?? '100')
      const data = getExperiencesForSync(db, since, limit)
      return c.json(data, 200)
    })

    // GET /sync/stats — 同步统计
    app.get('/sync/stats', (c) => {
      const stats = getSyncStats(db)
      return c.json({ stats }, 200)
    })

    // ── Phase 2F：Dashboard API + UI ────────────────────────

    createDashboardApi(app, db)
    createVisibilityToggleApi(app, db)
    serveDashboardUI(app)
  }

  // 404 fallback
  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404)
  })

  return app
}
