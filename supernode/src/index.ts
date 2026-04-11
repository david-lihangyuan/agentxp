import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { getDb, initDb } from './db.js'

const PORT = parseInt(process.env.PORT ?? '3141', 10)
const HOST = process.env.HOST ?? '0.0.0.0'

// Initialize database
const db = getDb()
initDb(db)

const app = createApp(db)

serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
}, (info) => {
  console.log(`🦞 Serendip Supernode running on http://${HOST}:${info.port}`)
})
