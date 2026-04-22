// SPEC §5.5 — per-agent metrics.
import { Hono } from 'hono'
import type { Db } from '../db.js'
import { agentMetric, agentMetrics } from '../dashboard-api.js'
import { HEX64, parseLimit } from './common.js'

export function metricsRouter(db: Db) {
  const r = new Hono()

  r.get('/metrics/agents', (c) => {
    const limit = parseLimit(c.req.query('limit'), 50, 500)
    return c.json({ agents: agentMetrics(db, limit) })
  })

  r.get('/metrics/agent/:pubkey', (c) => {
    const pk = c.req.param('pubkey')
    if (!HEX64.test(pk)) return c.json({ error: 'invalid_pubkey' }, 400)
    const m = agentMetric(db, pk)
    if (!m) return c.json({ error: 'not_found' }, 404)
    return c.json(m)
  })

  return r
}
