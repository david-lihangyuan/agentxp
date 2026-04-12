// Supernode — Entry Point
// Node.js HTTP server using @hono/node-server

import { serve } from '@hono/node-server'
import { createApp } from './app'
import { logger } from './logger'

const PORT = Number(process.env['PORT'] ?? 3141)

const app = createApp({
  dbPath: process.env['DATABASE_PATH'] ?? './data/supernode.db',
  circuitBreakerThreshold: Number(process.env['CIRCUIT_BREAKER_THRESHOLD'] ?? 10_000),
})

serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info('Supernode started', {
    method: 'BOOT',
    path: '/',
    duration_ms: 0,
    port: PORT,
    env: process.env['NODE_ENV'] ?? 'development',
  })
})

export default app
