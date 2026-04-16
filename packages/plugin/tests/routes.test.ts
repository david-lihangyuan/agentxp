import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'
import { createDb } from '../src/db.js'
import type { Db } from '../src/db.js'
import { createRouteHandlers, registerRoutes, resetRateLimits } from '../src/routes.js'
import { DEFAULT_CONFIG } from '../src/types.js'

// ─── Mock helpers ──────────────────────────────────────────────────────────

function mockReq(url: string, method = 'GET'): IncomingMessage {
  return { url, method } as any
}

function mockRes(): ServerResponse & { _status: number; _body: string; _headers: Record<string, string> } {
  const res = {
    _status: 200,
    _body: '',
    _headers: {} as Record<string, string>,
    writeHead(s: number, h?: any) {
      res._status = s
      if (h) Object.assign(res._headers, h)
    },
    end(body?: string) {
      if (body) res._body += body
    },
    write(chunk: string) {
      res._body += chunk
    },
  }
  return res as any
}

function insertSampleLesson(db: Db, overrides: Partial<{ what: string; tags: string[] }> = {}) {
  return db.insertLesson({
    what: overrides.what ?? 'test scenario',
    tried: 'tried this',
    outcome: 'it worked',
    learned: 'learned that',
    source: 'local',
    tags: overrides.tags ?? ['test'],
  })
}

// ─── GET /status ───────────────────────────────────────────────────────────

describe('GET /plugins/agentxp/status', () => {
  let db: Db
  let handlers: ReturnType<typeof createRouteHandlers>

  beforeEach(() => {
    db = createDb()
    handlers = createRouteHandlers(db, DEFAULT_CONFIG)
  })
  afterEach(() => { db.close() })

  it('returns 200 with JSON', async () => {
    const req = mockReq('/plugins/agentxp/status')
    const res = mockRes()
    await handlers.status(req, res)
    expect(res._status).toBe(200)
    expect(res._headers['Content-Type']).toBe('application/json')
  })

  it('includes lesson count', async () => {
    insertSampleLesson(db)
    insertSampleLesson(db)
    const req = mockReq('/plugins/agentxp/status')
    const res = mockRes()
    await handlers.status(req, res)
    const body = JSON.parse(res._body)
    expect(body.lessons).toBe(2)
  })

  it('includes injection stats', async () => {
    db.insertInjectionLog({ sessionId: 'sess1', injected: true, tokenCount: 100, lessonIds: [1] })
    const req = mockReq('/plugins/agentxp/status')
    const res = mockRes()
    await handlers.status(req, res)
    const body = JSON.parse(res._body)
    expect(body.injections).toBeDefined()
    expect(body.injections.total).toBe(1)
    expect(body.injections.injected).toBe(1)
  })

  it('includes FTS5 status', async () => {
    const req = mockReq('/plugins/agentxp/status')
    const res = mockRes()
    await handlers.status(req, res)
    const body = JSON.parse(res._body)
    expect(body.fts5).toBeDefined()
    expect(typeof body.fts5.available).toBe('boolean')
  })
})

// ─── GET /lessons ──────────────────────────────────────────────────────────

describe('GET /plugins/agentxp/lessons', () => {
  let db: Db
  let handlers: ReturnType<typeof createRouteHandlers>

  beforeEach(() => {
    db = createDb()
    handlers = createRouteHandlers(db, DEFAULT_CONFIG)
  })
  afterEach(() => { db.close() })

  it('returns paginated lessons with defaults', async () => {
    for (let i = 0; i < 5; i++) insertSampleLesson(db, { what: `lesson ${i}` })
    const req = mockReq('/plugins/agentxp/lessons')
    const res = mockRes()
    await handlers.lessons(req, res)
    expect(res._status).toBe(200)
    const body = JSON.parse(res._body)
    expect(body.lessons).toHaveLength(5)
    expect(body.offset).toBe(0)
    expect(body.limit).toBe(20)
  })

  it('respects offset and limit params', async () => {
    for (let i = 0; i < 10; i++) insertSampleLesson(db, { what: `lesson ${i}` })
    const req = mockReq('/plugins/agentxp/lessons?offset=3&limit=2')
    const res = mockRes()
    await handlers.lessons(req, res)
    const body = JSON.parse(res._body)
    expect(body.lessons).toHaveLength(2)
    expect(body.offset).toBe(3)
    expect(body.limit).toBe(2)
  })

  it('caps limit at 100', async () => {
    const req = mockReq('/plugins/agentxp/lessons?limit=999')
    const res = mockRes()
    await handlers.lessons(req, res)
    const body = JSON.parse(res._body)
    expect(body.limit).toBe(100)
  })

  it('handles negative offset as 0', async () => {
    const req = mockReq('/plugins/agentxp/lessons?offset=-5')
    const res = mockRes()
    await handlers.lessons(req, res)
    const body = JSON.parse(res._body)
    expect(body.offset).toBe(0)
  })

  it('returns empty array when no lessons', async () => {
    const req = mockReq('/plugins/agentxp/lessons')
    const res = mockRes()
    await handlers.lessons(req, res)
    const body = JSON.parse(res._body)
    expect(body.lessons).toHaveLength(0)
  })
})

// ─── GET /traces ───────────────────────────────────────────────────────────

describe('GET /plugins/agentxp/traces', () => {
  let db: Db
  let handlers: ReturnType<typeof createRouteHandlers>

  beforeEach(() => {
    db = createDb()
    handlers = createRouteHandlers(db, DEFAULT_CONFIG)
  })
  afterEach(() => { db.close() })

  it('returns session list', async () => {
    db.insertTraceStep({ sessionId: 'sess-a', action: 'read', toolName: 'read', timestamp: Date.now() })
    db.insertTraceStep({ sessionId: 'sess-a', action: 'write', toolName: 'write', timestamp: Date.now() })
    db.insertTraceStep({ sessionId: 'sess-b', action: 'exec', toolName: 'exec', significance: 'error', timestamp: Date.now() })

    const req = mockReq('/plugins/agentxp/traces')
    const res = mockRes()
    await handlers.traces(req, res)

    expect(res._status).toBe(200)
    const body = JSON.parse(res._body)
    expect(body.sessions).toHaveLength(2)

    const sessA = body.sessions.find((s: any) => s.sessionId === 'sess-a')
    const sessB = body.sessions.find((s: any) => s.sessionId === 'sess-b')
    expect(sessA.stepCount).toBe(2)
    expect(sessA.hasErrors).toBe(false)
    expect(sessB.stepCount).toBe(1)
    expect(sessB.hasErrors).toBe(true)
  })

  it('returns empty when no traces', async () => {
    const req = mockReq('/plugins/agentxp/traces')
    const res = mockRes()
    await handlers.traces(req, res)
    const body = JSON.parse(res._body)
    expect(body.sessions).toHaveLength(0)
  })
})

// ─── GET /export ───────────────────────────────────────────────────────────

describe('GET /plugins/agentxp/export', () => {
  let db: Db
  let handlers: ReturnType<typeof createRouteHandlers>

  beforeEach(() => {
    resetRateLimits()
    db = createDb()
    handlers = createRouteHandlers(db, DEFAULT_CONFIG)
  })
  afterEach(() => { db.close() })

  it('returns JSONL format', async () => {
    insertSampleLesson(db, { what: 'lesson 1' })
    insertSampleLesson(db, { what: 'lesson 2' })
    const req = mockReq('/plugins/agentxp/export')
    const res = mockRes()
    await handlers.export(req, res)

    expect(res._status).toBe(200)
    expect(res._headers['Content-Type']).toBe('application/x-ndjson')
    expect(res._headers['Content-Disposition']).toContain('agentxp-export.jsonl')

    const lines = res._body.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('returns empty body when no lessons', async () => {
    const req = mockReq('/plugins/agentxp/export')
    const res = mockRes()
    await handlers.export(req, res)
    expect(res._status).toBe(200)
    expect(res._body).toBe('')
  })

  it('rate limits after 3 requests in 1 minute', async () => {
    for (let i = 0; i < 3; i++) {
      const res = mockRes()
      await handlers.export(mockReq('/plugins/agentxp/export'), res)
      expect(res._status).toBe(200)
    }

    // 4th request should be rate limited
    const res = mockRes()
    await handlers.export(mockReq('/plugins/agentxp/export'), res)
    expect(res._status).toBe(429)
    const body = JSON.parse(res._body)
    expect(body.error).toContain('Rate limit')
  })
})

// ─── POST /publish ─────────────────────────────────────────────────────────

describe('POST /plugins/agentxp/publish', () => {
  let db: Db
  let handlers: ReturnType<typeof createRouteHandlers>

  beforeEach(() => {
    db = createDb()
    handlers = createRouteHandlers(db, DEFAULT_CONFIG)
  })
  afterEach(() => { db.close() })

  it('rejects non-POST methods', async () => {
    const req = mockReq('/plugins/agentxp/publish', 'GET')
    const res = mockRes()
    await handlers.publish(req, res)
    expect(res._status).toBe(405)
  })

  it('publishes unpublished lessons', async () => {
    const id1 = insertSampleLesson(db, { what: 'unpub 1' })
    const id2 = insertSampleLesson(db, { what: 'unpub 2' })

    const req = mockReq('/plugins/agentxp/publish', 'POST')
    const res = mockRes()
    await handlers.publish(req, res)

    expect(res._status).toBe(200)
    const body = JSON.parse(res._body)
    expect(body.published).toBe(2)
    expect(body.message).toContain('2 lesson(s)')

    // Verify published log entries exist
    const log1 = db.getPublishedLog(id1)
    const log2 = db.getPublishedLog(id2)
    expect(log1).toHaveLength(1)
    expect(log2).toHaveLength(1)
  })

  it('returns zero when no unpublished lessons', async () => {
    const req = mockReq('/plugins/agentxp/publish', 'POST')
    const res = mockRes()
    await handlers.publish(req, res)
    const body = JSON.parse(res._body)
    expect(body.published).toBe(0)
    expect(body.message).toContain('No unpublished')
  })

  it('does not re-publish already published lessons', async () => {
    const id = insertSampleLesson(db, { what: 'already published' })
    db.insertPublishedLog({ lessonId: id, publishedAt: Date.now() })

    const req = mockReq('/plugins/agentxp/publish', 'POST')
    const res = mockRes()
    await handlers.publish(req, res)
    const body = JSON.parse(res._body)
    expect(body.published).toBe(0)
  })
})

// ─── registerRoutes ────────────────────────────────────────────────────────

describe('registerRoutes', () => {
  it('registers all 5 routes on the API', () => {
    const db = createDb()
    const registered: Array<{ path: string; auth: string }> = []

    const mockApi = {
      registerHttpRoute(opts: any) {
        registered.push({ path: opts.path, auth: opts.auth })
      },
    }

    registerRoutes(mockApi, db, DEFAULT_CONFIG)

    expect(registered).toHaveLength(5)
    expect(registered.map(r => r.path)).toEqual([
      '/plugins/agentxp/status',
      '/plugins/agentxp/lessons',
      '/plugins/agentxp/traces',
      '/plugins/agentxp/export',
      '/plugins/agentxp/publish',
    ])
    expect(registered.every(r => r.auth === 'gateway')).toBe(true)

    db.close()
  })
})
