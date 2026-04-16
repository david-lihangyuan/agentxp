/**
 * routes.ts — HTTP route handlers for AgentXP plugin.
 *
 * Exports testable handler functions and a registerRoutes wrapper
 * for the OpenClaw plugin API.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import type { Db } from './db.js'
import type { PluginConfig } from './types.js'

// ─── Rate Limiting ─────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, number[]>()

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const timestamps = rateLimitMap.get(key) ?? []
  const recent = timestamps.filter(t => now - t < windowMs)
  if (recent.length >= maxRequests) return false
  recent.push(now)
  rateLimitMap.set(key, recent)
  return true
}

/** Reset rate limit state (for testing). */
export function resetRateLimits(): void {
  rateLimitMap.clear()
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://localhost')
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// ─── Route Handlers ────────────────────────────────────────────────────────

export function createRouteHandlers(db: Db, _config: PluginConfig) {
  return {
    /** GET /plugins/agentxp/status */
    status: async (_req: IncomingMessage, res: ServerResponse) => {
      const lessonCount = db.getLessonCount()
      const injectionStats = db.getInjectionStats()
      const fts5 = db.getFts5Status()
      jsonResponse(res, 200, {
        lessons: lessonCount,
        injections: injectionStats,
        fts5: fts5,
      })
    },

    /** GET /plugins/agentxp/lessons?offset=0&limit=20 */
    lessons: async (req: IncomingMessage, res: ServerResponse) => {
      const url = parseUrl(req)
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)
      const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20), 100)
      const lessons = db.listLessonsPaginated(offset, limit)
      jsonResponse(res, 200, { lessons, offset, limit })
    },

    /** GET /plugins/agentxp/traces */
    traces: async (_req: IncomingMessage, res: ServerResponse) => {
      const sessions = db.listTraceSessions()
      jsonResponse(res, 200, { sessions })
    },

    /** GET /plugins/agentxp/export — JSONL download (rate limited: 3/min) */
    export: async (_req: IncomingMessage, res: ServerResponse) => {
      if (!checkRateLimit('export', 3, 60_000)) {
        jsonResponse(res, 429, { error: 'Rate limit exceeded' })
        return
      }
      const lessons = db.listAllLessons()
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': 'attachment; filename="agentxp-export.jsonl"',
      })
      for (const lesson of lessons) {
        res.write(JSON.stringify(lesson) + '\n')
      }
      res.end()
    },

    /** POST /plugins/agentxp/publish — trigger batch publish */
    publish: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }
      const unpublished = db.listUnpublishedLessons()
      if (unpublished.length === 0) {
        jsonResponse(res, 200, { published: 0, message: 'No unpublished lessons' })
        return
      }

      // Mark as published
      let published = 0
      for (const lesson of unpublished) {
        if (lesson.id != null) {
          db.insertPublishedLog({ lessonId: lesson.id, publishedAt: Date.now() })
          published++
        }
      }

      jsonResponse(res, 200, { published, message: `Published ${published} lesson(s)` })
    },
  }
}

// ─── Registration ──────────────────────────────────────────────────────────

export function registerRoutes(api: any, db: Db, config: PluginConfig): void {
  const handlers = createRouteHandlers(db, config)

  api.registerHttpRoute({
    path: '/plugins/agentxp/status',
    auth: 'gateway',
    match: 'exact',
    handler: handlers.status,
  })

  api.registerHttpRoute({
    path: '/plugins/agentxp/lessons',
    auth: 'gateway',
    match: 'exact',
    handler: handlers.lessons,
  })

  api.registerHttpRoute({
    path: '/plugins/agentxp/traces',
    auth: 'gateway',
    match: 'exact',
    handler: handlers.traces,
  })

  api.registerHttpRoute({
    path: '/plugins/agentxp/export',
    auth: 'gateway',
    gatewayRuntimeScopeSurface: 'trusted-operator',
    match: 'exact',
    handler: handlers.export,
  })

  api.registerHttpRoute({
    path: '/plugins/agentxp/publish',
    auth: 'gateway',
    gatewayRuntimeScopeSurface: 'trusted-operator',
    match: 'exact',
    handler: handlers.publish,
  })
}
