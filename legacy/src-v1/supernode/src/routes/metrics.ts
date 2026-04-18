// H8/H9: Metrics & A/B tracking — /api/v1/metrics/*

import type { Hono } from 'hono'
import type { MetricsAPI } from '../agentxp/metrics-api'
import { validatePubkeyMiddleware } from '../validate'

export interface MetricsDeps {
  metricsAPI: MetricsAPI
}

export function registerMetricsRoutes(api: Hono, deps: MetricsDeps): void {
  const { metricsAPI } = deps

  // GET /api/v1/metrics/agents — all agents ranked
  api.get('/metrics/agents', (c) => {
    return c.json(metricsAPI.getAllAgentMetrics())
  })

  // GET /api/v1/metrics/agent/:pubkey — single agent detailed
  api.get('/metrics/agent/:pubkey', validatePubkeyMiddleware('pubkey'), (c) => {
    const pubkey = c.req.param('pubkey')
    const detail = metricsAPI.getAgentDetailedMetrics(pubkey)
    if (!detail) return c.json({ error: 'agent not found' }, 404)
    return c.json(detail)
  })

  // GET /api/v1/metrics/ab-summary — A/B comparison
  api.get('/metrics/ab-summary', (c) => {
    return c.json(metricsAPI.getABSummary())
  })
}
