// Supernode — Hono Application
// All /api/v1/ routes live under ./routes/; this file only wires services,
// middleware, and route modules together.

import { Hono } from 'hono'
import type Database from 'better-sqlite3'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from './db'
import { RateLimiter, getClientIp } from './rate-limit'
import { CircuitBreaker, setCircuitBreaker } from './circuit-breaker'
import { EventHandler } from './protocol/event-handler'
import { IdentityStore } from './protocol/identity-store'
import { NodeRegistry } from './protocol/node-registry'
import { SyncManager } from './protocol/sync'
import { ExperienceStore } from './agentxp/experience-store'
import { ExperienceSearch } from './agentxp/experience-search'
import { SubscriptionManager } from './agentxp/subscriptions'
import { PulseAPI } from './agentxp/pulse-api'
import { ImpactScoring } from './agentxp/scoring'
import { ImpactVisibility } from './agentxp/impact-visibility'
import { ExperienceRelations } from './agentxp/relations'
import { VisibilityManager } from './agentxp/visibility'
import { DashboardAPI } from './agentxp/dashboard-api'
import { MetricsAPI } from './agentxp/metrics-api'
import { ColdStartStore } from './agentxp/cold-start-store'
import { createLogger } from './logger'
import { loadABGroups } from './ab-groups'

import { registerLetterRoutes } from './agentxp/human-layer/letters'
import { registerAgentVoiceRoutes } from './agentxp/human-layer/agent-voice'
import { registerHumanContributionRoutes } from './agentxp/human-layer/human-contribution'
import { registerLegacyRoutes } from './agentxp/human-layer/legacy'
import { registerTrustRoutes } from './agentxp/human-layer/trust'

import { registerEventsRoutes } from './routes/events'
import { registerSubscriptionsRoutes } from './routes/subscriptions'
import { registerIdentitiesRoutes } from './routes/identities'
import { registerNodesRoutes } from './routes/nodes'
import { registerSyncRoutes } from './routes/sync'
import { registerPulseRoutes } from './routes/pulse'
import { registerExperiencesRoutes } from './routes/experiences'
import { registerVisibilityRoutes } from './routes/visibility'
import { registerDashboardApiRoutes } from './routes/dashboard-api'
import { registerMetricsRoutes } from './routes/metrics'
import { registerColdStartRoutes } from './routes/cold-start'
import { registerDashboardStaticRoutes } from './routes/dashboard-static'

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
  const db = opts.db ?? openDatabase(opts.dbPath ?? ':memory:')

  // --- Infrastructure ---
  const logger = createLogger()
  const rateLimiter = new RateLimiter({
    windowMs: opts.rateLimitWindow,
    perIpLimit: opts.perIpLimit,
    perPubkeyLimit: opts.perPubkeyLimit,
  })
  const circuitBreaker = new CircuitBreaker({ threshold: opts.circuitBreakerThreshold })
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
  const pulseAPI = new PulseAPI(db)
  const impactScoring = new ImpactScoring(db)
  const impactVisibility = new ImpactVisibility(db)
  const experienceRelations = new ExperienceRelations(db)
  const visibilityManager = new VisibilityManager(db)
  const dashboardAPI = new DashboardAPI(db)
  const metricsAPI = new MetricsAPI(db)
  const coldStartStore = new ColdStartStore(db)
  metricsAPI.registerABGroups(loadABGroups(process.env['AB_GROUPS_PATH']))

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const dashboardDir = join(__dirname, '..', 'dashboard')

  // --- Global Middleware ---
  app.use('*', async (c, next) => {
    const start = Date.now()
    const method = c.req.method
    const path = c.req.path
    await next()
    logger.info('Request', { method, path, status: c.res.status, duration_ms: Date.now() - start })
  })
  app.use('*', async (c, next) => {
    const ip = getClientIp(c.req.raw.headers)
    if (!rateLimiter.checkIp(ip)) {
      return c.json({ error: 'rate limit exceeded' }, 429)
    }
    await next()
  })

  // --- Health Endpoint (not under /api/v1/ — standard practice) ---
  app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }))

  // --- /api/v1/ Routes ---
  const api = new Hono()
  registerEventsRoutes(api, { db, eventHandler, experienceStore, experienceSearch, circuitBreaker })
  registerSubscriptionsRoutes(api, { subscriptionManager })
  registerIdentitiesRoutes(api, { db, identityStore })
  registerNodesRoutes(api, { nodeRegistry })
  registerSyncRoutes(api, { syncManager, nodeRegistry })
  registerPulseRoutes(api, { pulseAPI })
  registerExperiencesRoutes(api, { db, impactScoring, impactVisibility, experienceRelations })
  registerVisibilityRoutes(api, { visibilityManager })
  registerDashboardApiRoutes(api, { db, dashboardAPI })
  registerMetricsRoutes(api, { metricsAPI })
  registerLetterRoutes(api, db)
  registerAgentVoiceRoutes(api, db)
  registerHumanContributionRoutes(api, db)
  registerLegacyRoutes(api, db)
  registerTrustRoutes(api, db)
  app.route('/api/v1', api)

  // --- Cold-start + dashboard static assets (outside /api/v1) ---
  registerColdStartRoutes(app, { coldStartStore })
  registerDashboardStaticRoutes(app, { dashboardDir })

  // --- 404 for unversioned /api/ paths (must come AFTER /api/v1 mount) ---
  app.all('/api/*', (c) => c.json({ error: 'not found — use /api/v1/' }, 404))

  return app
}
