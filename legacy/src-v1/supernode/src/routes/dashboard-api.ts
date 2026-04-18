// F1: Dashboard Data API — /api/v1/dashboard/*

import type { Hono } from 'hono'
import type Database from 'better-sqlite3'
import type { DashboardAPI } from '../agentxp/dashboard-api'
import { validatePubkeyMiddleware } from '../validate'

export interface DashboardApiDeps {
  db: Database.Database
  dashboardAPI: DashboardAPI
}

export function registerDashboardApiRoutes(api: Hono, deps: DashboardApiDeps): void {
  const { db, dashboardAPI } = deps

  api.get('/dashboard/operator/:pubkey/summary', validatePubkeyMiddleware('pubkey'), (c) => {
    const pubkey = c.req.param('pubkey')
    if (!dashboardAPI.operatorExists(pubkey)) {
      return c.json({ error: 'operator not found' }, 404)
    }
    const summary = dashboardAPI.getOperatorSummary(pubkey)
    return c.json(summary)
  })

  api.get('/dashboard/operator/:pubkey/growth', validatePubkeyMiddleware('pubkey'), (c) => {
    const pubkey = c.req.param('pubkey')
    if (!dashboardAPI.operatorExists(pubkey)) {
      return c.json({ error: 'operator not found' }, 404)
    }
    const growth = dashboardAPI.getOperatorGrowth(pubkey)
    return c.json(growth)
  })

  api.get('/dashboard/operator/:pubkey/failures', validatePubkeyMiddleware('pubkey'), (c) => {
    const pubkey = c.req.param('pubkey')
    if (!dashboardAPI.operatorExists(pubkey)) {
      return c.json({ error: 'operator not found' }, 404)
    }
    const failures = dashboardAPI.getFailureImpact(pubkey)
    return c.json(failures)
  })

  api.get('/dashboard/operator/:pubkey/weekly-report', validatePubkeyMiddleware('pubkey'), (c) => {
    const pubkey = c.req.param('pubkey')
    if (!dashboardAPI.operatorExists(pubkey)) {
      return c.json({ error: 'operator not found' }, 404)
    }
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

  api.get('/dashboard/experiences', (c) => {
    const result = dashboardAPI.getExperienceList()
    return c.json(result)
  })

  api.get('/dashboard/network', (c) => {
    const result = dashboardAPI.getNetworkOverview()
    return c.json(result)
  })
}
