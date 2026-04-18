// Hono application builder. Routes mounted per SPEC 01-interfaces §5.
import { Hono } from 'hono'
import type { SerendipEvent } from '@serendip/protocol'
import type { Db } from './db.js'
import { ingestEvent } from './event-handler.js'
import { getEvent, listEvents } from './event-store.js'
import { listExperiences } from './experience-store.js'
import { search } from './experience-search.js'
import { getIdentity } from './identity-store.js'
import { listPulse } from './pulse-store.js'
import { computeScore } from './scoring.js'
import { getTrace } from './trace-store.js'
import {
  agentMetric,
  agentMetrics,
  networkOverview,
  operatorFailures,
  operatorGrowth,
  operatorSummary,
  recentExperiences,
} from './dashboard-api.js'
import { DASHBOARD_HTML } from './dashboard-html.js'

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
    const viewer = c.req.query('viewer_pubkey')
    const opts = viewer && HEX64.test(viewer) ? { viewerPubkey: viewer } : {}
    const results = search(db, q, limit, opts)
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

  // SPEC 01-interfaces §5.3 GET /pulse — observational feed only.
  api.get('/pulse', (c) => {
    const parsedLimit = Number(c.req.query('limit') ?? '50')
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 500)
      : 50
    const pulses = listPulse(db, limit)
    return c.json({ pulses, next_cursor: null })
  })

  // SPEC 01-interfaces §5.4 — per-experience impact + score + relations.
  api.get('/experiences/:id/impact', (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
    if (!getEvent(db, id)) return c.json({ error: 'not_found' }, 404)
    const s = computeScore(db, id)
    return c.json({ impact_score: s.impact_score, verifications: s.verifications })
  })

  api.get('/experiences/:id/score', (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
    if (!getEvent(db, id)) return c.json({ error: 'not_found' }, 404)
    const s = computeScore(db, id)
    return c.json({
      impact_score: s.impact_score,
      components: {
        semantic_matches: s.components.search_hits,
        verified_useful: s.components.verified_useful,
        superseded_by_count: s.components.superseded_by_count,
      },
      last_updated: s.last_updated ?? 0,
    })
  })

  api.get('/experiences/:id/relations', (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
    const outgoing = db
      .prepare(
        `SELECT to_experience_id AS to_id, relation_type AS relation
           FROM experience_relations WHERE from_experience_id = ?`,
      )
      .all(id) as Array<{ to_id: string; relation: string }>
    const incoming = db
      .prepare(
        `SELECT from_experience_id AS from_id, relation_type AS relation
           FROM experience_relations WHERE to_experience_id = ?`,
      )
      .all(id) as Array<{ from_id: string; relation: string }>
    return c.json({ incoming, outgoing })
  })

  // Verification-style relation submission (§5.4).
  api.post('/experiences/:id/relations', async (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
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

  // L2 trace read convenience (SPEC §12: access via event endpoints).
  // Additive per 01-interfaces §1 versioning.
  api.get('/experiences/:id/trace', (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
    const t = getTrace(db, id)
    if (!t) return c.json({ error: 'not_found' }, 404)
    return c.json(t)
  })

  // SPEC §5.5 Observational reads.
  api.get('/dashboard/operator/:pubkey/summary', (c) => {
    const pk = c.req.param('pubkey')
    if (!HEX64.test(pk)) return c.json({ error: 'invalid_pubkey' }, 400)
    const s = operatorSummary(db, pk)
    if (!s) return c.json({ error: 'not_found' }, 404)
    return c.json(s)
  })

  api.get('/dashboard/operator/:pubkey/growth', (c) => {
    const pk = c.req.param('pubkey')
    if (!HEX64.test(pk)) return c.json({ error: 'invalid_pubkey' }, 400)
    const parsed = Number(c.req.query('days') ?? '30')
    const days = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 365) : 30
    return c.json({ buckets: operatorGrowth(db, pk, days) })
  })

  api.get('/dashboard/operator/:pubkey/failures', (c) => {
    const pk = c.req.param('pubkey')
    if (!HEX64.test(pk)) return c.json({ error: 'invalid_pubkey' }, 400)
    const parsed = Number(c.req.query('limit') ?? '20')
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 200) : 20
    return c.json({ failures: operatorFailures(db, pk, limit) })
  })

  api.get('/dashboard/experiences', (c) => {
    const parsed = Number(c.req.query('limit') ?? '20')
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 200) : 20
    return c.json({ experiences: recentExperiences(db, limit) })
  })

  api.get('/dashboard/network', (c) => c.json(networkOverview(db)))

  api.get('/metrics/agents', (c) => {
    const parsed = Number(c.req.query('limit') ?? '50')
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 500) : 50
    return c.json({ agents: agentMetrics(db, limit) })
  })

  api.get('/metrics/agent/:pubkey', (c) => {
    const pk = c.req.param('pubkey')
    if (!HEX64.test(pk)) return c.json({ error: 'invalid_pubkey' }, 400)
    const m = agentMetric(db, pk)
    if (!m) return c.json({ error: 'not_found' }, 404)
    return c.json(m)
  })

  app.route('/api/v1', api)

  // SPEC §7 Dashboard UI — served read-only under /dashboard.
  app.get('/dashboard', (c) =>
    c.html(DASHBOARD_HTML),
  )

  return app
}
