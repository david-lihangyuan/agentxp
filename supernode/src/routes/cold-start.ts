// Cold-start pipeline routes — /api/cold-start/*
// Active seed-pipeline routes for harvesting Stack Overflow questions and
// recording AI-generated solutions. Mounted directly on `app` (not under
// /api/v1/). Verified solutions are surfaced via /api/cold-start/solutions
// for an operator to review and submit through the signed /contribute
// endpoint; the relay itself never synthesizes events.
//
// See scripts/cold-start/pipeline.ts for the harvest → solve → verify
// driver that feeds these endpoints, and docs/plans/2026-04-12-cold-start-
// pipeline-design.md for the design.

import type { Hono } from 'hono'
import type { ColdStartStore } from '../agentxp/cold-start-store'
import { parseLimit } from '../validate'
import {
  parseBody,
  ColdStartStatusBody,
  ColdStartClaimBody,
  ColdStartVerifyBody,
} from '../schemas'

export interface ColdStartDeps {
  coldStartStore: ColdStartStore
}

export function registerColdStartRoutes(app: Hono, deps: ColdStartDeps): void {
  const { coldStartStore } = deps

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

  // POST /api/cold-start/verify — process verification result (updates
  // question + solution status). Verified solutions are surfaced via
  // /api/cold-start/solutions?status=verified; operators republish them
  // through the signed /operator/:pubkey/contribute endpoint.
  app.post('/api/cold-start/verify', async (c) => {
    const parsed = await parseBody(c, ColdStartVerifyBody)
    if (!parsed.ok) return parsed.response
    const { solution_event_id, passed } = parsed.data
    const result = coldStartStore.processVerification(solution_event_id, passed)
    if (!result.ok) return c.json({ error: result.error }, 400)
    return c.json({ ok: true })
  })

  // GET /api/cold-start/stats — pipeline statistics
  app.get('/api/cold-start/stats', (c) => {
    const stats = coldStartStore.getStats()
    return c.json(stats)
  })
}
