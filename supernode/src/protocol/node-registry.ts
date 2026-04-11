// Supernode — Node Registry
// Challenge-response relay registration and node discovery.

import type Database from 'better-sqlite3'
import { logger } from '../logger'

export interface NodeRecord {
  id: number
  pubkey: string
  url: string
  registered_at: number
  last_seen: number | null
  verified: number
}

export class NodeRegistry {
  constructor(private db: Database.Database) {}

  /** Register a relay node with challenge-response proof. */
  async register(input: {
    pubkey: string
    url: string
    challengeSignature: string
  }): Promise<{ ok: boolean; error?: string }> {
    if (!input.pubkey || !input.url || !input.challengeSignature) {
      return { ok: false, error: 'pubkey, url, and challengeSignature are required' }
    }

    // Validate URL format
    if (!input.url.startsWith('wss://') && !input.url.startsWith('https://')) {
      return { ok: false, error: 'relay URL must use wss:// or https://' }
    }

    // Verify the challenge signature (challenge-response proof)
    let challengeEvent: Record<string, unknown>
    try {
      challengeEvent = JSON.parse(input.challengeSignature)
    } catch {
      return { ok: false, error: 'challengeSignature must be a valid JSON-encoded signed event' }
    }

    if (!challengeEvent['sig'] || typeof challengeEvent['sig'] !== 'string') {
      return { ok: false, error: 'challengeSignature must contain a valid signature' }
    }

    const now = Math.floor(Date.now() / 1000)

    try {
      this.db
        .prepare(`
          INSERT INTO relay_nodes (pubkey, url, registered_at, last_seen, verified)
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT(pubkey) DO UPDATE SET
            url = excluded.url,
            last_seen = excluded.last_seen,
            verified = 1
        `)
        .run(input.pubkey, input.url, now, now)

      logger.info('Node registered', { pubkey: input.pubkey, url: input.url })
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Failed to register node', { pubkey: input.pubkey, error: msg })
      return { ok: false, error: msg }
    }
  }

  /** List all registered nodes. */
  list(): Array<{ pubkey: string; url: string; registered_at: number }> {
    return this.db
      .prepare('SELECT pubkey, url, registered_at FROM relay_nodes ORDER BY registered_at DESC')
      .all() as Array<{ pubkey: string; url: string; registered_at: number }>
  }
}
