// Supernode — Entry Point
// Starts the Hono server with Bun's native HTTP server.

import { createApp } from './app'
import { logger } from './logger'

const PORT = Number(process.env['PORT'] ?? 3141)

const app = createApp({
  dbPath: process.env['DATABASE_PATH'] ?? './data/supernode.db',
  circuitBreakerThreshold: Number(process.env['CIRCUIT_BREAKER_THRESHOLD'] ?? 10_000),
})

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
})

logger.info('Supernode started', {
  method: 'BOOT',
  path: '/',
  duration_ms: 0,
  port: PORT,
  env: process.env['NODE_ENV'] ?? 'development',
})

export default app
