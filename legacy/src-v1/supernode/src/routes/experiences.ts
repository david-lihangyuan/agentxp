// Experience read-side routes — /api/v1/experiences, impact, score, relations

import type { Hono } from 'hono'
import type Database from 'better-sqlite3'
import type { ImpactScoring } from '../agentxp/scoring'
import type { ImpactVisibility } from '../agentxp/impact-visibility'
import type { ExperienceRelations } from '../agentxp/relations'
import { buildContributorTypeFilter } from '../agentxp/human-layer/human-contribution'
import { parseBody, ExperienceRelationBody } from '../schemas'

export interface ExperiencesDeps {
  db: Database.Database
  impactScoring: ImpactScoring
  impactVisibility: ImpactVisibility
  experienceRelations: ExperienceRelations
}

export function registerExperiencesRoutes(api: Hono, deps: ExperiencesDeps): void {
  const { db, impactScoring, impactVisibility, experienceRelations } = deps

  // C2b: experience impact visibility
  api.get('/experiences/:id/impact', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid experience id' }, 400)
    const result = impactVisibility.getImpact(id)
    return c.json(result)
  })

  // C3: experience score
  api.get('/experiences/:id/score', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid experience id' }, 400)
    const result = impactScoring.getScore(id)
    return c.json(result)
  })

  // C3b: experience dialogue relations
  api.post('/experiences/:id/relations', async (c) => {
    const fromId = Number(c.req.param('id'))
    if (!Number.isFinite(fromId)) return c.json({ error: 'invalid experience id' }, 400)

    const parsed = await parseBody(c, ExperienceRelationBody)
    if (!parsed.ok) return parsed.response

    const result = experienceRelations.addRelation(
      fromId,
      parsed.data.target_id,
      parsed.data.relation_type,
      parsed.data.pubkey ?? 'unknown'
    )

    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ ok: true, id: result.id }, 201)
  })

  api.get('/experiences/:id/relations', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid experience id' }, 400)
    const relations = experienceRelations.getRelations(id)
    return c.json({ relations })
  })

  // GET /api/v1/experiences — with optional contributor_type filter (HL3)
  api.get('/experiences', (c) => {
    const contributorType = c.req.query('contributor_type')
    const filter = buildContributorTypeFilter(contributorType)
    const rows = db
      .prepare(`SELECT id, event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, scope, is_failure, embedding_status, created_at, indexed_at, last_activity_at, contributor_type, trust_weight FROM experiences WHERE 1=1${filter} ORDER BY created_at DESC LIMIT 200`)
      .all() as Array<Record<string, unknown>>
    return c.json({ experiences: rows })
  })
}
