// SPEC 01-interfaces §5.1 — event ingestion and event read-back.
import { Hono } from 'hono'
import type { Db } from '../db.js'
import { getEvent, listEvents } from '../event-store.js'
import { HEX64, ingestAndRespond, parseLimit } from './common.js'

export function eventsRouter(db: Db) {
  const r = new Hono()

  r.post('/events', (c) => ingestAndRespond(c, db))

  r.get('/events/:id', (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
    const ev = getEvent(db, id)
    if (!ev) return c.json({ error: 'not_found' }, 404)
    return c.json({ event: ev })
  })

  r.get('/events', (c) => {
    const url = new URL(c.req.url)
    const limit = parseLimit(url.searchParams.get('limit') ?? undefined, 50, 500)
    const kindParam = url.searchParams.get('kind')
    const pubkeyParam = url.searchParams.get('pubkey')
    const sinceParam = url.searchParams.get('since')
    const untilParam = url.searchParams.get('until')
    const events = listEvents(db, {
      kind: kindParam ?? undefined,
      pubkey: pubkeyParam ?? undefined,
      since: sinceParam !== null ? Number(sinceParam) : undefined,
      until: untilParam !== null ? Number(untilParam) : undefined,
      limit,
    })
    return c.json({ events, next_cursor: null })
  })

  return r
}
