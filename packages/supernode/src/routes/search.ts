// SPEC 01-interfaces §5.2 — search.
import { Hono } from 'hono'
import type { Db } from '../db.js'
import { search } from '../experience-search.js'
import { HEX64, parseLimit } from './common.js'

export function searchRouter(db: Db) {
  const r = new Hono()

  r.get('/search', (c) => {
    const q = c.req.query('q')
    if (!q) return c.json({ error: 'missing_q', field: 'q' }, 400)
    const limit = parseLimit(c.req.query('limit'), 10, 50)
    const viewer = c.req.query('viewer_pubkey')
    const opts = viewer && HEX64.test(viewer) ? { viewerPubkey: viewer } : {}
    const results = search(db, q, limit, opts)
    return c.json({ results })
  })

  return r
}
