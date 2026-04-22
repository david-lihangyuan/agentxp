// SPEC 01-interfaces §5 — identity read.
import { Hono } from 'hono'
import type { Db } from '../db.js'
import { getIdentity } from '../identity-store.js'
import { HEX64 } from './common.js'

export function identitiesRouter(db: Db) {
  const r = new Hono()

  r.get('/identities/:pubkey', (c) => {
    const pubkey = c.req.param('pubkey')
    if (!HEX64.test(pubkey)) return c.json({ error: 'invalid_pubkey' }, 400)
    const row = getIdentity(db, pubkey)
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json({
      pubkey: row.pubkey,
      kind: row.kind,
      operator_pubkey: row.operator_pubkey,
      delegated_at: row.delegated_at,
      expires_at: row.expires_at,
      revoked: row.revoked,
      agent_id: row.agent_id,
    })
  })

  return r
}
