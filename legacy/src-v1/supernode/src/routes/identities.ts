// Identity routes — GET /api/v1/identities/:pubkey, GET /api/v1/sync/identity

import type { Hono } from 'hono'
import type Database from 'better-sqlite3'
import type { IdentityStore } from '../protocol/identity-store'
import { validatePubkeyMiddleware } from '../validate'

export interface IdentitiesDeps {
  db: Database.Database
  identityStore: IdentityStore
}

export function registerIdentitiesRoutes(api: Hono, deps: IdentitiesDeps): void {
  const { db, identityStore } = deps

  api.get('/identities/:pubkey', validatePubkeyMiddleware('pubkey'), (c) => {
    const pubkey = c.req.param('pubkey')
    const identity = identityStore.get(pubkey)
    if (!identity) return c.json({ error: 'not found' }, 404)
    return c.json(identity)
  })

  // Expose identity events for relay sync bootstrap
  api.get('/sync/identity', (c) => {
    const identityEvents = db
      .prepare(`
        SELECT * FROM events
        WHERE kind IN ('identity.register', 'identity.delegate', 'identity.revoke')
        ORDER BY created_at ASC
      `)
      .all()
    return c.json(identityEvents)
  })
}
