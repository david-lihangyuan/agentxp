import type { Context } from 'hono'

export interface HealthStatus {
  status: 'ok'
  version: string
  timestamp: string
  uptime: number
}

const startTime = Date.now()

export function healthHandler(c: Context): Response {
  const status: HealthStatus = {
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  }
  return c.json(status, 200)
}
