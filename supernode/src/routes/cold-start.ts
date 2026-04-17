// Cold-start pipeline routes — /api/cold-start/*
// Bootstrap-era routes for harvesting Stack Overflow questions, recording
// AI-generated solutions, and auto-publishing verified solutions as
// experiences. Mounted directly on `app` (not under /api/v1/).

import type { Hono } from 'hono'
import type Database from 'better-sqlite3'
import type { ColdStartStore } from '../agentxp/cold-start-store'
import type { ExperienceStore } from '../agentxp/experience-store'
import type { Logger } from '../logger'
import { parseLimit } from '../validate'
import {
  parseBody,
  ColdStartStatusBody,
  ColdStartClaimBody,
  ColdStartVerifyBody,
} from '../schemas'

export interface ColdStartDeps {
  db: Database.Database
  coldStartStore: ColdStartStore
  experienceStore: ExperienceStore
  logger: Logger
}

export function registerColdStartRoutes(app: Hono, deps: ColdStartDeps): void {
  const { db, coldStartStore, experienceStore, logger } = deps

  // POST /api/cold-start/events — receive a cold-start protocol event
  app.post('/api/cold-start/events', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const result = coldStartStore.store(body as Parameters<typeof coldStartStore.store>[0])
    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }
    return c.json({ ok: true }, 201)
  })

  // GET /api/cold-start/questions — list intent.question events
  app.get('/api/cold-start/questions', (c) => {
    const status = c.req.query('status')
    const limit = parseLimit(c.req.query('limit'), 50, 100)
    const questions = coldStartStore.listQuestions({ status, limit })
    return c.json({ questions })
  })

  // GET /api/cold-start/solutions — list experience.solution events
  app.get('/api/cold-start/solutions', (c) => {
    const status = c.req.query('status')
    const limit = parseLimit(c.req.query('limit'), 50, 100)
    const solutions = coldStartStore.listSolutions({ status, limit })
    return c.json({ solutions })
  })

  // POST /api/cold-start/events/status — update event status
  app.post('/api/cold-start/events/status', async (c) => {
    const parsed = await parseBody(c, ColdStartStatusBody)
    if (!parsed.ok) return parsed.response
    const result = coldStartStore.updateStatus(parsed.data.event_id, parsed.data.status)
    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }
    return c.json({ ok: true })
  })

  // GET /api/cold-start/questions/:id/solutions — find solutions for a question
  app.get('/api/cold-start/questions/:id/solutions', (c) => {
    const questionId = c.req.param('id')
    const solutions = coldStartStore.findSolutionsForQuestion(questionId)
    return c.json({ solutions })
  })

  // GET /api/cold-start/solutions/:id/verifications — find verifications for a solution
  app.get('/api/cold-start/solutions/:id/verifications', (c) => {
    const solutionId = c.req.param('id')
    const verifications = coldStartStore.findVerificationsForSolution(solutionId)
    return c.json({ verifications })
  })

  // GET /api/cold-start/check-so/:soId — check if SO question already posted
  app.get('/api/cold-start/check-so/:soId', (c) => {
    const soId = c.req.param('soId')
    const exists = coldStartStore.isQuestionPosted(soId)
    return c.json({ exists })
  })

  // POST /api/cold-start/claim — claim a question for solving (prevents duplicate work)
  app.post('/api/cold-start/claim', async (c) => {
    const parsed = await parseBody(c, ColdStartClaimBody)
    if (!parsed.ok) return parsed.response
    const claimed = coldStartStore.claimForSolving(parsed.data.event_id, parsed.data.solver_pubkey)
    if (!claimed) {
      return c.json({ error: 'question not available (already claimed or not pending)' }, 409)
    }
    return c.json({ ok: true, claimed: true })
  })

  // POST /api/cold-start/verify — process verification result (updates question + solution status)
  // When verification passes, automatically publish the solution as an experience.
  app.post('/api/cold-start/verify', async (c) => {
    const parsed = await parseBody(c, ColdStartVerifyBody)
    if (!parsed.ok) return parsed.response
    const { solution_event_id, passed } = parsed.data
    const result = coldStartStore.processVerification(solution_event_id, passed)
    if (!result.ok) return c.json({ error: result.error }, 400)

    let experienceId: number | undefined
    if (passed) {
      experienceId = await autoPublishSolution(db, experienceStore, logger, solution_event_id)
    }
    return c.json({ ok: true, experience_id: experienceId })
  })

  // GET /api/cold-start/stats — pipeline statistics
  app.get('/api/cold-start/stats', (c) => {
    const stats = coldStartStore.getStats()
    return c.json(stats)
  })
}

// Auto-publish a verified cold-start solution as an experience. Builds a
// synthetic intent.broadcast event from the solution payload and runs it
// through the normal experience-store pipeline. On success, marks the
// solution row as 'published' to prevent double-publish.
async function autoPublishSolution(
  db: Database.Database,
  experienceStore: ExperienceStore,
  logger: Logger,
  solution_event_id: string,
): Promise<number | undefined> {
  try {
    const solRow = db
      .prepare('SELECT * FROM cold_start_events WHERE event_id = ?')
      .get(solution_event_id) as { payload: string; pubkey: string; created_at: number; tags: string; sig: string; event_id: string } | undefined
    if (!solRow) return undefined

    const solPayload = JSON.parse(solRow.payload)
    const solData = solPayload?.data ?? {}
    const what = solData.title
      ? `${solData.title} — ${(solData.root_cause || solData.approach || '').slice(0, 200)}`
      : solData.solution?.slice(0, 300) || 'Cold-start verified solution'
    const tried = Array.isArray(solData.tried) ? solData.tried.join('\n') : (solData.tried || solData.approach || '')
    const learned = solData.learned || solData.root_cause || ''
    const outcome = 'succeeded'

    const { createHash, randomBytes } = await import('node:crypto')
    const syntheticId = createHash('sha256')
      .update(`cold-start-publish:${solRow.event_id}:${Date.now()}`)
      .digest('hex')
    const syntheticEvent = {
      v: 1 as const,
      id: syntheticId,
      pubkey: solRow.pubkey,
      operator_pubkey: solRow.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 'intent.broadcast' as const,
      payload: {
        type: 'experience',
        data: { what, tried, outcome, learned, scope: solData.tags || [] },
      },
      tags: JSON.parse(solRow.tags || '[]'),
      visibility: 'public' as const,
      sig: randomBytes(64).toString('hex'),
    }
    const storeResult = experienceStore.store(syntheticEvent)
    if (storeResult.ok) {
      logger.info('Cold-start solution auto-published as experience', {
        solution_event_id,
        experience_id: storeResult.experienceId,
      })
      db.prepare("UPDATE cold_start_events SET status = 'published' WHERE event_id = ?")
        .run(solution_event_id)
      return storeResult.experienceId
    }
    logger.warn('Cold-start auto-publish failed', {
      solution_event_id,
      error: storeResult.error,
    })
    return undefined
  } catch (err) {
    logger.error('Cold-start auto-publish error', {
      solution_event_id,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}
