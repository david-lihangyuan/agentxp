// @serendip/supernode — server entry.
// Boots an HTTP server backed by a SQLite file.
import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { openDb } from './db.js'

export { buildApp } from './app.js'
export { openDb } from './db.js'
export type { AppOptions } from './app.js'

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  const url = new URL(`file://${entry}`).href
  return import.meta.url === url
}

export function start(options: { port?: number; dbPath?: string } = {}): void {
  const port = options.port ?? Number(process.env.PORT ?? 3141)
  const dbPath = options.dbPath ?? process.env.DB_PATH ?? 'agentxp.db'
  const db = openDb(dbPath)
  const app = buildApp({ db })
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`supernode listening on http://localhost:${info.port}`)
  })
}

if (isMainModule()) {
  start()
}
