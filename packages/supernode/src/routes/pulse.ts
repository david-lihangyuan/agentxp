// SPEC 01-interfaces §5.3 — pulse outcome ingest and observational feed.
import { Hono } from 'hono'
import type { Db } from '../db.js'
import { listPulse } from '../pulse-store.js'
import { ingestAndRespond, parseLimit } from './common.js'

export function pulseRouter(db: Db) {
  const r = new Hono()

  r.post('/pulse/outcome', (c) => ingestAndRespond(c, db))

  r.get('/pulse', (c) => {
    const limit = parseLimit(c.req.query('limit'), 50, 500)
    const pulses = listPulse(db, limit)
    return c.json({ pulses, next_cursor: null })
  })

  return r
}
