// Supernode — Hono Application
// All routes under /api/v1/. Health endpoint at /health.
// Middleware: structured logging, rate limiting, circuit breaker.

import { Hono } from 'hono'
import type Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from './db'
import { RateLimiter, getClientIp } from './rate-limit'
import { CircuitBreaker, getCircuitBreaker, setCircuitBreaker } from './circuit-breaker'
import { EventHandler } from './protocol/event-handler'
import { IdentityStore } from './protocol/identity-store'
import { NodeRegistry, generateChallenge } from './protocol/node-registry'
import { SyncManager } from './protocol/sync'
import { ExperienceStore } from './agentxp/experience-store'
import { ExperienceSearch } from './agentxp/experience-search'
import { SubscriptionManager } from './agentxp/subscriptions'
import { PulseStateMachine } from './agentxp/pulse'
import { PulseAPI } from './agentxp/pulse-api'
import { ImpactScoring } from './agentxp/scoring'
import { ImpactVisibility } from './agentxp/impact-visibility'
import { ExperienceRelations } from './agentxp/relations'
import { sanitize, relaySanitize } from './agentxp/sanitize'
import { classify } from './agentxp/classify'
import { VisibilityManager } from './agentxp/visibility'
import { DashboardAPI } from './agentxp/dashboard-api'
import { registerLetterRoutes } from './agentxp/human-layer/letters'
import { registerAgentVoiceRoutes } from './agentxp/human-layer/agent-voice'
import { registerHumanContributionRoutes, buildContributorTypeFilter } from './agentxp/human-layer/human-contribution'
import { registerLegacyRoutes } from './agentxp/human-layer/legacy'
import { registerTrustRoutes } from './agentxp/human-layer/trust'
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
  const syncManager = new SyncManager(db, nodeRegistry)
  const experienceStore = new ExperienceStore(db, circuitBreaker, {
    generateEmbedding: opts.generateEmbedding,
    pollIntervalMs: opts.generateEmbedding ? 500 : 0,
  })
  const experienceSearch = new ExperienceSearch(db, opts.generateEmbedding)
  const subscriptionManager = new SubscriptionManager(db)
  const pulseStateMachine = new PulseStateMachine(db)
  const pulseAPI = new PulseAPI(db)
  const impactScoring = new ImpactScoring(db)
  const impactVisibility = new ImpactVisibility(db)
  const experienceRelations = new ExperienceRelations(db)
  const visibilityManager = new VisibilityManager(db)
  const dashboardAPI = new DashboardAPI(db)

  // Resolve __dirname for ESM (needed to serve static dashboard files)
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

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

  // --- G1: Node Registry Routes ---

  // GET /api/v1/nodes/challenge — issue a registration challenge
  api.get('/nodes/challenge', (c) => {
    const challengeData = generateChallenge()
    return c.json(challengeData)
  })

  // GET /api/v1/nodes — list registered nodes with last_seen and status
  api.get('/nodes', (c) => {
    return c.json({ nodes: nodeRegistry.listWithStatus() })
  })

  // POST /api/v1/nodes/register — register with challenge-response proof
  api.post('/nodes/register', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const input = body as Record<string, unknown>

    // Support both old interface (pubkey/url/challengeSignature)
    // and new interface (relay_pubkey/challenge/signature/url)
    const result = input['relay_pubkey']
      ? await nodeRegistry.registerWithProof({
          relay_pubkey: input['relay_pubkey'] as string,
          challenge: input['challenge'] as string,
          signature: input['signature'] as string,
          url: input['url'] as string,
        })
      : await nodeRegistry.register({
          pubkey: input['pubkey'] as string,
          url: input['url'] as string,
          challengeSignature: input['challengeSignature'] as string,
        })

    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ success: true }, 201)
  })

  // POST /api/v1/nodes/:pubkey/heartbeat — update last_seen
  api.post('/nodes/:pubkey/heartbeat', (c) => {
    const pubkey = c.req.param('pubkey')
    const result = nodeRegistry.heartbeat(pubkey)
    if (!result.ok) {
      return c.json({ error: result.error }, 404)
    }
    return c.json({ ok: true })
  })

  // --- G2: Relay Sync Routes ---

  // GET /api/v1/sync — pull events for relay-to-relay sync
  api.get('/sync', (c) => {
    const relayPubkey = c.req.header('X-Relay-Pubkey')
    const relaySignature = c.req.header('X-Relay-Signature')

    // Require relay identity signature headers
    if (!relayPubkey || !relaySignature) {
      return c.json({ error: 'X-Relay-Pubkey and X-Relay-Signature headers are required' }, 401)
    }

    const sinceMs = Number(c.req.query('since') ?? 0)
    const kinds = c.req.query('kinds') ?? undefined

    const isRegistered = nodeRegistry.isRegistered(relayPubkey)

    const result = syncManager.getEventsForSync({
      since: sinceMs,
      kinds,
      relayPubkey,
      isRegistered,
    })

    return c.json(result)
  })

  // --- Pulse Routes ---
  api.get('/pulse', (c) => {
    const pubkey = c.req.query('pubkey')
    if (!pubkey) {
      return c.json({ error: 'pubkey is required' }, 400)
    }
    const since = Number(c.req.query('since') ?? 0)
    const result = pulseAPI.pull({ pubkey, since })
    return c.json(result)
  })

  api.post('/pulse/outcome', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const input = body as Record<string, unknown>
    if (!input['experience_id'] || !input['reporter_pubkey'] || !input['outcome']) {
      return c.json({ error: 'experience_id, reporter_pubkey, and outcome are required' }, 400)
    }

    const result = pulseAPI.reportOutcome({
      experienceId: input['experience_id'] as number,
      reporterPubkey: input['reporter_pubkey'] as string,
      outcome: input['outcome'] as string,
      context: input['context'] as Record<string, unknown> | undefined,
    })

    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ ok: true }, 201)
  })

  // --- Experience Impact Visibility (C2b) ---
  api.get('/experiences/:id/impact', (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'invalid experience id' }, 400)
    const result = impactVisibility.getImpact(id)
    return c.json(result)
  })

  // --- Experience Score (C3) ---
  api.get('/experiences/:id/score', (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'invalid experience id' }, 400)
    const result = impactScoring.getScore(id)
    return c.json(result)
  })

  // --- Experience Dialogue Relations (C3b) ---
  api.post('/experiences/:id/relations', async (c) => {
    const fromId = Number(c.req.param('id'))
    if (isNaN(fromId)) return c.json({ error: 'invalid experience id' }, 400)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const input = body as Record<string, unknown>
    if (!input['target_id'] || !input['relation_type']) {
      return c.json({ error: 'target_id and relation_type are required' }, 400)
    }

    const pubkey = (input['pubkey'] as string) ?? 'unknown'
    const result = experienceRelations.addRelation(
      fromId,
      Number(input['target_id']),
      input['relation_type'] as 'extends' | 'qualifies' | 'supersedes',
      pubkey
    )

    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ ok: true, id: result.id }, 201)
  })

  api.get('/experiences/:id/relations', (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'invalid experience id' }, 400)
    const relations = experienceRelations.getRelations(id)
    return c.json({ relations })
  })

  // --- D3: Operator Visibility API ---
  // GET /api/v1/visibility/:operator_pubkey → { default_visibility }
  api.get('/visibility/:operator_pubkey', (c) => {
    const operatorPubkey = c.req.param('operator_pubkey')
    const visibility = visibilityManager.getOperatorVisibility(operatorPubkey)
    if (visibility === null) {
      return c.json({ default_visibility: 'public' }) // system default
    }
    return c.json({ default_visibility: visibility })
  })

  // PATCH /api/v1/visibility/:operator_pubkey { default_visibility }
  api.patch('/visibility/:operator_pubkey', async (c) => {
    const operatorPubkey = c.req.param('operator_pubkey')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }
    const input = body as Record<string, unknown>
    const defaultVisibility = input['default_visibility']
    if (defaultVisibility !== 'public' && defaultVisibility !== 'private') {
      return c.json({ error: 'default_visibility must be public or private' }, 400)
    }
    visibilityManager.setOperatorVisibility(operatorPubkey, defaultVisibility)
    return c.json({ ok: true, default_visibility: defaultVisibility })
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

  // --- F1: Dashboard Data API Routes ---

  // Dashboard static asset helper (read from disk once per request)
  function readDashboardFile(filename: string): string {
    try {
      return readFileSync(join(__dirname, '..', 'dashboard', filename), 'utf8')
    } catch {
      return ''
    }
  }

  const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'"

  // GET /api/v1/dashboard/operator/:pubkey/summary
  api.get('/dashboard/operator/:pubkey/summary', (c) => {
    const pubkey = c.req.param('pubkey')
    if (!dashboardAPI.operatorExists(pubkey)) {
      return c.json({ error: 'operator not found' }, 404)
    }
    const summary = dashboardAPI.getOperatorSummary(pubkey)
    return c.json(summary)
  })

  // GET /api/v1/dashboard/operator/:pubkey/growth
  api.get('/dashboard/operator/:pubkey/growth', (c) => {
    const pubkey = c.req.param('pubkey')
    if (!dashboardAPI.operatorExists(pubkey)) {
      return c.json({ error: 'operator not found' }, 404)
    }
    const growth = dashboardAPI.getOperatorGrowth(pubkey)
    return c.json(growth)
  })

  // GET /api/v1/dashboard/operator/:pubkey/failures
  api.get('/dashboard/operator/:pubkey/failures', (c) => {
    const pubkey = c.req.param('pubkey')
    if (!dashboardAPI.operatorExists(pubkey)) {
      return c.json({ error: 'operator not found' }, 404)
    }
    const failures = dashboardAPI.getFailureImpact(pubkey)
    return c.json(failures)
  })

  // GET /api/v1/dashboard/operator/:pubkey/weekly-report
  api.get('/dashboard/operator/:pubkey/weekly-report', (c) => {
    const pubkey = c.req.param('pubkey')
    if (!dashboardAPI.operatorExists(pubkey)) {
      return c.json({ error: 'operator not found' }, 404)
    }
    // Retrieve latest weekly_report from operator_notifications
    const row = db
      .prepare(`
        SELECT content FROM operator_notifications
        WHERE operator_pubkey = ? AND type = 'weekly_report'
        ORDER BY created_at DESC LIMIT 1
      `)
      .get(pubkey) as { content: string } | undefined
    if (!row) {
      return c.json({ error: 'no weekly report available' }, 404)
    }
    try {
      return c.json(JSON.parse(row.content))
    } catch {
      return c.json({ error: 'malformed report' }, 500)
    }
  })

  // GET /api/v1/dashboard/experiences
  api.get('/dashboard/experiences', (c) => {
    const result = dashboardAPI.getExperienceList()
    return c.json(result)
  })

  // GET /api/v1/dashboard/network
  api.get('/dashboard/network', (c) => {
    const result = dashboardAPI.getNetworkOverview()
    return c.json(result)
  })

  // --- Human Layer Routes (HL1-HL6) ---

  // HL1: Letters to Agent
  registerLetterRoutes(api, db)

  // HL2: Agent Voice (notifications)
  registerAgentVoiceRoutes(api, db)

  // HL3: Human Direct Contribution
  registerHumanContributionRoutes(api, db)

  // HL5: Legacy View
  registerLegacyRoutes(api, db)

  // HL6: Trust Evolution
  registerTrustRoutes(api, db)

  // GET /api/v1/experiences — with optional contributor_type filter (HL3)
  api.get('/experiences', (c) => {
    const contributorType = c.req.query('contributor_type')
    const filter = buildContributorTypeFilter(contributorType)
    const rows = db
      .prepare(`SELECT id, what, tried, outcome, learned, tags, scope, contributor_type, trust_weight, created_at FROM experiences WHERE 1=1${filter} ORDER BY created_at DESC LIMIT 200`)
      .all() as Array<Record<string, unknown>>
    return c.json({ experiences: rows })
  })

  // --- Mount API routes under /api/v1/ ---
  app.route('/api/v1', api)

  // --- F2: Dashboard Web UI — static HTML files ---
  // GET /dashboard → index.html
  app.get('/dashboard', (c) => {
    const html = readDashboardFile('index.html')
    if (!html) return c.json({ error: 'dashboard not found' }, 404)
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CSP_HEADER,
      },
    })
  })

  // GET /dashboard/operator → operator.html
  app.get('/dashboard/operator', (c) => {
    const html = readDashboardFile('operator.html')
    if (!html) return c.json({ error: 'dashboard not found' }, 404)
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CSP_HEADER,
      },
    })
  })

  // GET /dashboard/app.js
  app.get('/dashboard/app.js', (c) => {
    const js = readDashboardFile('app.js')
    if (!js) return c.json({ error: 'not found' }, 404)
    return new Response(js, {
      status: 200,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  })

  // GET /dashboard/operator.js
  app.get('/dashboard/operator.js', (c) => {
    const js = readDashboardFile('operator.js')
    if (!js) return c.json({ error: 'not found' }, 404)
    return new Response(js, {
      status: 200,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  })

  // GET /dashboard/style.css
  app.get('/dashboard/style.css', (c) => {
    const css = readDashboardFile('style.css')
    if (!css) return c.json({ error: 'not found' }, 404)
    return new Response(css, {
      status: 200,
      headers: { 'Content-Type': 'text/css; charset=utf-8' },
    })
  })

  // --- 404 for unversioned /api/ paths (must come AFTER /api/v1 mount) ---
  app.all('/api/*', (c) => {
    return c.json({ error: 'not found — use /api/v1/' }, 404)
  })

  return app
}
