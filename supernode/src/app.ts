// Supernode — Hono Application
// All routes under /api/v1/. Health endpoint at /health.
// Middleware: structured logging, rate limiting, circuit breaker.

import { Hono } from 'hono'
import type Database from 'better-sqlite3'
import { openDatabase } from './db'
import { RateLimiter, getClientIp } from './rate-limit'
import { CircuitBreaker, getCircuitBreaker, setCircuitBreaker } from './circuit-breaker'
import { EventHandler } from './protocol/event-handler'
import { IdentityStore } from './protocol/identity-store'
import { NodeRegistry } from './protocol/node-registry'
import { ExperienceStore } from './agentxp/experience-store'
import { ExperienceSearch } from './agentxp/experience-search'
import { SubscriptionManager } from './agentxp/subscriptions'
import { createLogger } from './logger'
import { validateQueryTags, validatePubkey } from './validate'

export interface AppOptions {
  /** SQLite database path. Use ':memory:' for tests. */
  dbPath?: string
  /** Rate limit window in ms (default: 60000) */
  rateLimitWindow?: number
  /** Per-IP request limit per window (default: 100) */
  perIpLimit?: number
  /** Per-pubkey request limit per window (default: 50) */
  perPubkeyLimit?: number
  /** Circuit breaker threshold for embedding queue (default: 10000) */
  circuitBreakerThreshold?: number
  /** Pre-existing database instance (for testing) */
  db?: Database.Database
  /** Embedding generator function (for testing) */
  generateEmbedding?: (text: string) => Promise<number[]>
}

/** Create and configure the Hono application. */
export function createApp(opts: AppOptions = {}): Hono {
  const app = new Hono()

  // --- Database ---
  const db = opts.db ?? openDatabase(opts.dbPath ?? ':memory:')

  // --- Infrastructure ---
  const logger = createLogger()
  const rateLimiter = new RateLimiter({
    windowMs: opts.rateLimitWindow,
    perIpLimit: opts.perIpLimit,
    perPubkeyLimit: opts.perPubkeyLimit,
  })
  const circuitBreaker = new CircuitBreaker({
    threshold: opts.circuitBreakerThreshold,
  })
  setCircuitBreaker(app, circuitBreaker)

  // --- Domain Services ---
  const eventHandler = new EventHandler(db)
  const identityStore = new IdentityStore(db)
  const nodeRegistry = new NodeRegistry(db)
  const experienceStore = new ExperienceStore(db, circuitBreaker, {
    generateEmbedding: opts.generateEmbedding,
    pollIntervalMs: opts.generateEmbedding ? 500 : 0,
  })
  const experienceSearch = new ExperienceSearch(db, opts.generateEmbedding)
  const subscriptionManager = new SubscriptionManager(db)

  // --- Global Middleware: Request Logging ---
  app.use('*', async (c, next) => {
    const start = Date.now()
    const method = c.req.method
    const path = c.req.path
    await next()
    const duration = Date.now() - start
    logger.info('Request', {
      method,
      path,
      status: c.res.status,
      duration_ms: duration,
    })
  })

  // --- Global Middleware: Rate Limiting ---
  app.use('*', async (c, next) => {
    const ip = getClientIp(c.req.raw.headers)
    if (!rateLimiter.checkIp(ip)) {
      return c.json({ error: 'rate limit exceeded' }, 429)
    }
    await next()
  })

  // --- Health Endpoint (not under /api/v1/ — standard practice) ---
  app.get('/health', (c) => {
    return c.json({ status: 'ok', version: '0.1.0' })
  })

  // ===== /api/v1/ Routes =====

  const api = new Hono()

  // --- GET /api/v1/events — list recent events ---
  api.get('/events', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)
    const events = db
      .prepare('SELECT id, pubkey, kind, created_at, tags, visibility FROM events ORDER BY created_at DESC LIMIT ?')
      .all(limit)
    return c.json({ events })
  })

  // --- POST /api/v1/events — HTTP compat layer for event ingestion ---
  api.post('/events', async (c) => {
    // Circuit breaker check for intent.broadcast
    if (circuitBreaker.isOpen()) {
      return c.json({ error: 'service unavailable: embedding queue full' }, 503)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const result = await eventHandler.handleEvent(body)
    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    // Process experience events
    const ev = body as { kind?: string }
    if (ev.kind === 'intent.broadcast') {
      const expResult = experienceStore.store(body as Parameters<typeof experienceStore.store>[0])
      if (!expResult.ok && expResult.error?.includes('circuit breaker')) {
        return c.json({ error: expResult.error }, 503)
      }
    }

    return c.json({ ok: true }, 201)
  })

  // --- GET /api/v1/events/:id ---
  api.get('/events/:id', (c) => {
    const id = c.req.param('id')
    const event = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(id) as Record<string, unknown> | null
    if (!event) return c.json({ error: 'not found' }, 404)
    return c.json(event)
  })

  // --- GET /api/v1/search ---
  api.get('/search', async (c) => {
    const query = c.req.query('q') ?? ''
    const tagsParam = c.req.query('tags') ?? null
    const outcomeFilter = c.req.query('filter[outcome]')
    const operatorPubkey = c.req.query('operator_pubkey')
    const platform = c.req.query('env[platform]')

    // Validate tags if provided
    const tagValidation = validateQueryTags(tagsParam)
    if (!tagValidation.valid) {
      return c.json({ error: tagValidation.error }, 400)
    }

    const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined

    const results = await experienceSearch.search({
      query,
      tags,
      filter: outcomeFilter ? { outcome: outcomeFilter } : undefined,
      operatorPubkey,
      env: platform ? { platform } : undefined,
    })

    return c.json(results)
  })

  // --- POST /api/v1/subscriptions ---
  api.post('/subscriptions', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const input = body as Record<string, unknown>
    if (!input['pubkey'] || !input['query']) {
      return c.json({ error: 'pubkey and query are required' }, 400)
    }

    const pubkeyValidation = validatePubkey(input['pubkey'])
    if (!pubkeyValidation.valid) {
      return c.json({ error: pubkeyValidation.error }, 400)
    }

    const result = subscriptionManager.subscribe({
      pubkey: input['pubkey'] as string,
      operatorPubkey: (input['operator_pubkey'] as string) ?? (input['pubkey'] as string),
      query: input['query'] as string,
      tags: input['tags'] as string[] | undefined,
    })

    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ ok: true, id: result.id }, 201)
  })

  // --- GET /api/v1/subscriptions ---
  api.get('/subscriptions', (c) => {
    const operatorPubkey = c.req.query('operator_pubkey')
    const pubkey = c.req.query('pubkey')

    if (!operatorPubkey && !pubkey) {
      return c.json({ error: 'operator_pubkey or pubkey required' }, 400)
    }

    const subs = operatorPubkey
      ? subscriptionManager.listForOperator(operatorPubkey)
      : subscriptionManager.listForPubkey(pubkey!)

    return c.json({ subscriptions: subs })
  })

  // --- Identity Routes ---
  api.get('/identities/:pubkey', (c) => {
    const pubkey = c.req.param('pubkey')
    const identity = identityStore.get(pubkey)
    if (!identity) return c.json({ error: 'not found' }, 404)
    return c.json(identity)
  })

  // --- Node Registry Routes ---
  api.get('/nodes', (c) => {
    return c.json({ nodes: nodeRegistry.list() })
  })

  api.post('/nodes/register', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const input = body as Record<string, unknown>
    const result = await nodeRegistry.register({
      pubkey: input['pubkey'] as string,
      url: input['url'] as string,
      challengeSignature: input['challengeSignature'] as string,
    })

    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ ok: true }, 201)
  })

  // --- Relay Sync: expose identity events for bootstrap ---
  api.get('/sync/identity', (c) => {
    const identityEvents = db
      .prepare(`
        SELECT * FROM events
        WHERE kind IN ('identity.register', 'identity.delegate', 'identity.revoke')
        ORDER BY created_at ASC
      `)
      .all()
    return c.json(identityEvents)
  })

  // --- Mount API routes under /api/v1/ ---
  app.route('/api/v1', api)

  // --- 404 for unversioned /api/ paths (must come AFTER /api/v1 mount) ---
  app.all('/api/*', (c) => {
    return c.json({ error: 'not found — use /api/v1/' }, 404)
  })

  return app
}
