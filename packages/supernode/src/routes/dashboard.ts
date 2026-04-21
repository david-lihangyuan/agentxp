// SPEC §5.5 — observational dashboard reads.
import { Hono } from 'hono'
import type { Db } from '../db.js'
import {
  networkOverview,
  operatorFailures,
  operatorGrowth,
  operatorSummary,
  recentExperiences,
} from '../dashboard-api.js'
import { HEX64, parseLimit } from './common.js'

export function dashboardRouter(db: Db) {
  const r = new Hono()

  r.get('/dashboard/operator/:pubkey/summary', (c) => {
    const pk = c.req.param('pubkey')
    if (!HEX64.test(pk)) return c.json({ error: 'invalid_pubkey' }, 400)
    const s = operatorSummary(db, pk)
    if (!s) return c.json({ error: 'not_found' }, 404)
    return c.json(s)
  })

  r.get('/dashboard/operator/:pubkey/growth', (c) => {
    const pk = c.req.param('pubkey')
    if (!HEX64.test(pk)) return c.json({ error: 'invalid_pubkey' }, 400)
    const days = parseLimit(c.req.query('days'), 30, 365)
    return c.json({ buckets: operatorGrowth(db, pk, days) })
  })

  r.get('/dashboard/operator/:pubkey/failures', (c) => {
    const pk = c.req.param('pubkey')
    if (!HEX64.test(pk)) return c.json({ error: 'invalid_pubkey' }, 400)
    const limit = parseLimit(c.req.query('limit'), 20, 200)
    return c.json({ failures: operatorFailures(db, pk, limit) })
  })

  r.get('/dashboard/experiences', (c) => {
    const limit = parseLimit(c.req.query('limit'), 20, 200)
    return c.json({ experiences: recentExperiences(db, limit) })
  })

  r.get('/dashboard/network', (c) => c.json(networkOverview(db)))

  return r
}
