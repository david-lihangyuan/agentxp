// Hono application builder. Routes mounted per SPEC 01-interfaces §5.
// Individual endpoint bodies live under ./routes/; this file only
// stitches the sub-routers together and exposes /health + /dashboard.
import { Hono } from 'hono'
import type { Db } from './db.js'
import { DASHBOARD_HTML } from './dashboard-html.js'
import {
  dashboardRouter,
  eventsRouter,
  experiencesRouter,
  identitiesRouter,
  metricsRouter,
  pulseRouter,
  searchRouter,
} from './routes/index.js'

export interface AppOptions {
  db: Db
  version?: string
}

export function buildApp(opts: AppOptions) {
  const { db } = opts
  const app = new Hono()

  app.get('/health', (c) => c.json({ status: 'ok', version: opts.version ?? '0.1.0' }))

  const api = new Hono()
  api.route('/', eventsRouter(db))
  api.route('/', searchRouter(db))
  api.route('/', experiencesRouter(db))
  api.route('/', identitiesRouter(db))
  api.route('/', pulseRouter(db))
  api.route('/', dashboardRouter(db))
  api.route('/', metricsRouter(db))

  app.route('/api/v1', api)

  // SPEC §7 Dashboard UI — served read-only under /dashboard.
  app.get('/dashboard', (c) => c.html(DASHBOARD_HTML))

  return app
}
