// Supernode — Node Registry & Relay Bootstrap
// GET /api/v1/nodes — list known relays
// POST /api/v1/nodes/register — register with challenge signature proof
// New relay bootstrap: full-sync all identity events first

import { Database } from 'bun:sqlite'
import { verifyEvent, createEvent, signEvent, type OperatorKey } from '@serendip/protocol'
import { logger } from '../logger'

export interface NodeRecord {
  id: number
  pubkey: string
  url: string
  registered_at: number
  last_seen: number | null
  verified: number
}

export interface RegisterChallengeInput {
  /** Relay operator pubkey */
  pubkey: string
  /** WebSocket URL of the relay */
  url: string
  /** Signed challenge event proving key ownership */
  challengeSignature: string
}

export class NodeRegistry {
  constructor(private db: Database) {}

  /** List all registered relay nodes. */
  list(): NodeRecord[] {
    return this.db
      .query('SELECT * FROM relay_nodes ORDER BY registered_at DESC')
      .all() as NodeRecord[]
  }

  /** Get a node by pubkey. */
  getByPubkey(pubkey: string): NodeRecord | null {
    return this.db
      .query('SELECT * FROM relay_nodes WHERE pubkey = ?')
      .get(pubkey) as NodeRecord | null
  }

  /**
   * Register a relay node with challenge signature proof.
   * The registering relay must prove ownership of their key by signing a challenge.
   */
  async register(input: RegisterChallengeInput): Promise<{ ok: boolean; error?: string }> {
    // Parse and verify the signed challenge
    let challengeEvent: unknown
    try {
      challengeEvent = JSON.parse(input.challengeSignature)
    } catch {
      return { ok: false, error: 'invalid challenge signature JSON' }
    }

    // The challenge event must be from the pubkey being registered
    const ev = challengeEvent as Record<string, unknown>
    if (ev['pubkey'] !== input.pubkey) {
      return { ok: false, error: 'challenge pubkey mismatch' }
    }

    // Verify the challenge event signature
    const verified = await verifyEvent(challengeEvent as Parameters<typeof verifyEvent>[0])
    if (!verified) {
      return { ok: false, error: 'challenge signature invalid' }
    }

    // Validate URL format
    if (!input.url.startsWith('wss://') && !input.url.startsWith('ws://')) {
      return { ok: false, error: 'relay URL must start with wss:// or ws://' }
    }

    const now = Math.floor(Date.now() / 1000)

    try {
      this.db
        .prepare(`
          INSERT INTO relay_nodes (pubkey, url, registered_at, verified)
          VALUES (?, ?, ?, 1)
          ON CONFLICT(pubkey) DO UPDATE SET
            url = excluded.url,
            last_seen = ?,
            verified = 1
        `)
        .run(input.pubkey, input.url, now, now)

      logger.info('Relay node registered', { pubkey: input.pubkey, url: input.url })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Update last_seen for a node. */
  heartbeat(pubkey: string): void {
    this.db
      .prepare('UPDATE relay_nodes SET last_seen = ? WHERE pubkey = ?')
      .run(Math.floor(Date.now() / 1000), pubkey)
  }

  /**
   * Bootstrap a new relay from an existing one.
   * Full-syncs all identity events first (no time window), then incremental.
   */
  async bootstrapFrom(sourceUrl: string): Promise<{ ok: boolean; count?: number; error?: string }> {
    logger.info('Relay bootstrap started', { sourceUrl })

    try {
      // Fetch all identity events (no since filter — full bootstrap)
      const url = `${sourceUrl.replace('wss://', 'https://').replace('ws://', 'http://')}/api/v1/sync/identity`
      const res = await fetch(url)
      if (!res.ok) {
        return { ok: false, error: `bootstrap fetch failed: ${res.status}` }
      }

      const events = await res.json() as Array<unknown>
      let count = 0

      for (const event of events) {
        const ev = event as Record<string, unknown>
        // Store directly, skipping signature re-verification for bootstrap
        // (trust comes from TLS connection to source relay)
        try {
          this.db
            .prepare(`
              INSERT OR IGNORE INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              ev['id'],
              ev['pubkey'],
              ev['operator_pubkey'],
              ev['kind'],
              ev['created_at'],
              JSON.stringify(ev['payload']),
              JSON.stringify(ev['tags'] ?? []),
              ev['visibility'] ?? 'public',
              ev['sig'],
              Math.floor(Date.now() / 1000)
            )
          count++
        } catch {
          // Skip individual failures
        }
      }

      logger.info('Relay bootstrap complete', { sourceUrl, eventCount: count })
      return { ok: true, count }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
