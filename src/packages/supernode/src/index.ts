// @serendip/supernode — server entry.
// Boots an HTTP server backed by a SQLite file.
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { openDb } from './db.js'

export { buildApp } from './app.js'
export { openDb } from './db.js'
export type { AppOptions } from './app.js'

// Process managers (e.g. PM2's ProcessContainerFork.js) set argv[1] to
// their own wrapper path, so a naive `argv[1] === import.meta.url` check
// would keep start() from ever running. PM2 exposes the true entry via
// pm_exec_path; fall back to argv[1] for unwrapped invocations.
export function isMainModule(
  moduleUrl: string = import.meta.url,
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const entry = env['pm_exec_path'] ?? argv[1]
  if (!entry) return false
  return pathToFileURL(entry).href === moduleUrl
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
