// SPEC 01-interfaces §5.4 — experience listing, impact/score,
// relations, and trace.
import { Hono } from 'hono'
import type { Db } from '../db.js'
import { getEvent } from '../event-store.js'
import { listExperiences } from '../experience-store.js'
import { computeScore } from '../scoring.js'
import { getTrace } from '../trace-store.js'
import { HEX64, ingestAndRespond, parseLimit } from './common.js'

export function experiencesRouter(db: Db) {
  const r = new Hono()

  r.get('/experiences', (c) => {
    const limit = parseLimit(c.req.query('limit'), 20, 200)
    const pubkey = c.req.query('pubkey')
    const experiences = listExperiences(db, { pubkey, limit })
    return c.json({ experiences, next_cursor: null })
  })

  r.get('/experiences/:id/impact', (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
    if (!getEvent(db, id)) return c.json({ error: 'not_found' }, 404)
    const s = computeScore(db, id)
    return c.json({ impact_score: s.impact_score, verifications: s.verifications })
  })

  r.get('/experiences/:id/score', (c) => {
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

  r.get('/experiences/:id/relations', (c) => {
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
  r.post('/experiences/:id/relations', (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
    return ingestAndRespond(c, db)
  })

  // L2 trace read convenience (SPEC §12: access via event endpoints).
  // Additive per 01-interfaces §1 versioning.
  r.get('/experiences/:id/trace', (c) => {
    const id = c.req.param('id')
    if (!HEX64.test(id)) return c.json({ error: 'invalid_id' }, 400)
    const t = getTrace(db, id)
    if (!t) return c.json({ error: 'not_found' }, 404)
    return c.json(t)
  })

  return r
}
