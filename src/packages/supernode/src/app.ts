// Hono application builder. Routes mounted per SPEC 01-interfaces §5.
import { Hono } from 'hono'
import type { SerendipEvent } from '@serendip/protocol'
import type { Db } from './db.js'
import { ingestEvent } from './event-handler.js'
import { getEvent, listEvents } from './event-store.js'
import { listExperiences } from './experience-store.js'
import { search } from './experience-search.js'
import { getIdentity } from './identity-store.js'

export interface AppOptions {
  db: Db
  version?: string
}

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/

function structuralCheck(e: unknown): e is SerendipEvent {
  if (typeof e !== 'object' || e === null) return false
  const x = e as Record<string, unknown>
  return (
    x.v === 1 &&
    typeof x.id === 'string' && HEX64.test(x.id) &&
    typeof x.pubkey === 'string' && HEX64.test(x.pubkey) &&
    typeof x.operator_pubkey === 'string' && HEX64.test(x.operator_pubkey) &&
    typeof x.created_at === 'number' &&
    typeof x.kind === 'string' &&
    typeof x.payload === 'object' && x.payload !== null &&
    Array.isArray(x.tags) &&
    (x.visibility === 'public' || x.visibility === 'private') &&
    typeof x.sig === 'string' && HEX128.test(x.sig)
  )
}

export function buildApp(opts: AppOptions) {
  const { db } = opts
  const app = new Hono()

  app.get('/health', (c) => c.json({ status: 'ok', version: opts.version ?? '0.1.0' }))

  const api = new Hono()

  api.post('/events', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { event?: unknown } | null
    if (!body || !structuralCheck(body.event)) {
      return c.json({ error: 'malformed_event' }, 400)
    }
    const result = await ingestEvent(db, body.event)
    if (!result.ok) {
      return c.json(
        { error: result.error, ...(result.field ? { field: result.field } : {}) },
        result.status,
      )
    }
    return c.json({
      accepted: true,
      event_id: result.event_id,
      merkle_proof: result.event_id,
      received_at: result.received_at,
    })
  })

  api.get('/events/:id', (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
    const ev = getEvent(db, id)
    if (!ev) return c.json({ error: 'not_found' }, 404)
    return c.json({ event: ev })
  })

  api.get('/events', (c) => {
    const url = new URL(c.req.url)
    const parsedLimit = Number(url.searchParams.get('limit') ?? '50')
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 500)
      : 50
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

  api.get('/search', (c) => {
    const q = c.req.query('q')
    if (!q) return c.json({ error: 'missing_q', field: 'q' }, 400)
    const parsedLimit = Number(c.req.query('limit') ?? '10')
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 50)
      : 10
    const results = search(db, q, limit)
    return c.json({ results })
  })

  api.get('/experiences', (c) => {
    const parsedLimit = Number(c.req.query('limit') ?? '20')
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 200)
      : 20
    const pubkey = c.req.query('pubkey')
    const experiences = listExperiences(db, { pubkey, limit })
    return c.json({ experiences, next_cursor: null })
  })

  api.get('/identities/:pubkey', (c) => {
    const pubkey = c.req.param('pubkey')
    if (!HEX64.test(pubkey)) return c.json({ error: 'invalid_pubkey' }, 400)
    const row = getIdentity(db, pubkey)
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json({
      pubkey: row.pubkey,
      kind: row.kind,
      operator_pubkey: row.operator_pubkey,
      delegated_at: row.delegated_at,
      expires_at: row.expires_at,
      revoked: row.revoked,
      agent_id: row.agent_id,
    })
  })

  api.post('/pulse/outcome', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { event?: unknown } | null
    if (!body || !structuralCheck(body.event)) {
      return c.json({ error: 'malformed_event' }, 400)
    }
    const result = await ingestEvent(db, body.event)
    if (!result.ok) {
      return c.json(
        { error: result.error, ...(result.field ? { field: result.field } : {}) },
        result.status,
      )
    }
    return c.json({
      accepted: true,
      event_id: result.event_id,
      merkle_proof: result.event_id,
      received_at: result.received_at,
    })
  })

  app.route('/api/v1', api)
  return app
}
