// G2: Relay sync route — GET /api/v1/sync

import type { Hono } from 'hono'
import type { SyncManager } from '../protocol/sync'
import type { NodeRegistry } from '../protocol/node-registry'
import { parseNonNegInt } from '../validate'

export interface SyncDeps {
  syncManager: SyncManager
  nodeRegistry: NodeRegistry
}

export function registerSyncRoutes(api: Hono, deps: SyncDeps): void {
  const { syncManager, nodeRegistry } = deps

  // GET /api/v1/sync — pull events for relay-to-relay sync
  api.get('/sync', (c) => {
    const relayPubkey = c.req.header('X-Relay-Pubkey')
    const relaySignature = c.req.header('X-Relay-Signature')

    if (!relayPubkey || !relaySignature) {
      return c.json({ error: 'X-Relay-Pubkey and X-Relay-Signature headers are required' }, 401)
    }

    const sinceMs = parseNonNegInt(c.req.query('since'), 0)
    const kinds = c.req.query('kinds') ?? undefined

    const isRegistered = nodeRegistry.isRegistered(relayPubkey)

    const result = syncManager.getEventsForSync({
      since: sinceMs,
      kinds,
      relayPubkey,
      isRegistered,
    })

    return c.json(result)
  })
}
