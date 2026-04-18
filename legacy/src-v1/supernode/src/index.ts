// Supernode — Entry Point
// Node.js HTTP server using @hono/node-server

import { serve } from '@hono/node-server'
import { createApp } from './app'
import { logger } from './logger'

const PORT = Number(process.env['PORT'] ?? 3141)
const OPENAI_API_KEY = process.env['OPENAI_API_KEY'] ?? ''

// OpenAI embedding function
async function generateEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    logger.warn('No OPENAI_API_KEY set, embedding disabled', { method: 'EMBEDDING', path: '/', duration_ms: 0 })
    return []
  }
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
  })
  if (!res.ok) {
    const err = await res.text()
    logger.warn('Embedding API error', { method: 'EMBEDDING', path: '/', duration_ms: 0, error: err.slice(0, 200) })
    return []
  }
  const data = await res.json() as { data: Array<{ embedding: number[] }> }
  return data.data[0]?.embedding ?? []
}

const app = createApp({
  dbPath: process.env['DATABASE_PATH'] ?? './data/supernode.db',
  circuitBreakerThreshold: Number(process.env['CIRCUIT_BREAKER_THRESHOLD'] ?? 10_000),
  generateEmbedding: OPENAI_API_KEY ? generateEmbedding : undefined,
})

serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info('Supernode started', {
    method: 'BOOT',
    path: '/',
    duration_ms: 0,
    port: PORT,
    env: process.env['NODE_ENV'] ?? 'development',
    embeddingEnabled: !!OPENAI_API_KEY,
  })
})

export default app
