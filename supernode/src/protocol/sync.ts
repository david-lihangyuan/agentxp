// Supernode — Pull-Based Relay Sync
// Handles GET /api/v1/sync endpoint and scheduled sync from known peers.
// Verified relays (admin-whitelisted via RELAY_TRUSTED_NODES): `full` scope.
// Registered-but-unverified or unknown relays: `public_only` scope.

import type Database from 'better-sqlite3'
import { verifyEvent, type SerendipEvent } from '@serendip/protocol'
import { NodeRegistry } from './node-registry'
import { logger } from '../logger'

/** Sync interval: 5 minutes in milliseconds. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000

export interface SyncResult {
  synced: number
  skipped: number
  errors: number
}

/** Type for a fetch-like function used internally (supports test injection). */
export type FetchFn = (path: string, opts?: RequestInit) => Promise<Response>

export class SyncManager {
  /** Exposed as static so tests can verify the configured interval. */
  static readonly SYNC_INTERVAL_MS = SYNC_INTERVAL_MS

  private schedulerHandle: ReturnType<typeof setInterval> | null = null

  constructor(
    private db: Database.Database,
    private nodeRegistry: NodeRegistry,
  ) {}

  /**
   * Query the local events table for sync response.
   * Verified relays get `full` scope; everyone else gets `public_only`.
   *
   * @param since - Unix timestamp in milliseconds (since parameter from query)
   * @param kinds - Comma-separated list of kinds to filter (optional)
   * @param relayPubkey - The requesting relay's pubkey (from X-Relay-Pubkey header)
   * @param isVerified - Whether the requesting relay is on the admin trust list
   */
  getEventsForSync(params: {
    since: number
    kinds?: string
    relayPubkey: string
    isVerified: boolean
  }): { events: SerendipEvent[]; data_scope: 'full' | 'public_only' } {
    const sinceSec = Math.floor(params.since / 1000)

    let query: string
    let bindings: unknown[]

    if (params.kinds) {
      const kindList = params.kinds.split(',').map((k) => k.trim()).filter(Boolean)
      if (kindList.length === 0) {
        return { events: [], data_scope: params.isVerified ? 'full' : 'public_only' }
      }

      const placeholders = kindList.map(() => '?').join(',')
      query = `
        SELECT id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig
        FROM events
        WHERE created_at >= ?
          AND kind IN (${placeholders})
          AND visibility = 'public'
        ORDER BY created_at ASC
        LIMIT 1000
      `
      bindings = [sinceSec, ...kindList]
    } else {
      query = `
        SELECT id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig
        FROM events
        WHERE created_at >= ?
          AND visibility = 'public'
        ORDER BY created_at ASC
        LIMIT 1000
      `
      bindings = [sinceSec]
    }

    const rows = this.db.prepare(query).all(...bindings) as Array<{
      id: string
      pubkey: string
      operator_pubkey: string
      kind: string
      created_at: number
      payload: string
      tags: string
      visibility: string
      sig: string
    }>

    const events = rows.map((r) => ({
      v: 1 as const,
      id: r.id,
      pubkey: r.pubkey,
      operator_pubkey: r.operator_pubkey,
      kind: r.kind as SerendipEvent['kind'],
      created_at: r.created_at,
      payload: JSON.parse(r.payload),
      tags: JSON.parse(r.tags),
      visibility: r.visibility as 'public' | 'private',
      sig: r.sig,
    }))

    return {
      events,
      data_scope: params.isVerified ? 'full' : 'public_only',
    }
  }

  /**
   * Ingest a single event received from a peer relay.
   * Verifies signature before storing.
   * Returns true if stored, false if rejected (invalid sig, duplicate, etc.).
   */
  async ingestSyncEvent(event: SerendipEvent): Promise<boolean> {
    // Verify signature
    let valid: boolean
    try {
      valid = await verifyEvent(event)
    } catch {
      logger.warn('Sync event signature verification error', { event_id: event.id })
      return false
    }

    if (!valid) {
      logger.warn('Sync event rejected: invalid signature', { event_id: event.id })
      return false
    }

    // Check for duplicate
    const existing = this.db
      .prepare('SELECT id FROM events WHERE id = ?')
      .get(event.id)
    if (existing) {
      return false // Already stored — not an error, just a duplicate
    }

    // Store the event
    try {
      const now = Math.floor(Date.now() / 1000)
      this.db
        .prepare(`
          INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.id,
          event.pubkey,
          event.operator_pubkey,
          event.kind,
          event.created_at,
          JSON.stringify(event.payload),
          JSON.stringify(event.tags),
          event.visibility,
          event.sig,
          now
        )

      logger.info('Sync event stored', { event_id: event.id, kind: event.kind })
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Failed to store sync event', { event_id: event.id, error: msg })
      return false
    }
  }

  /**
   * Fetch all identity events from a peer relay for bootstrap.
   * Identity events are always fetched without a time filter.
   */
  async fetchIdentityBootstrap(fetchFn: FetchFn): Promise<SerendipEvent[]> {
    try {
      const res = await fetchFn('/api/v1/sync/identity')
      if (!res.ok) {
        logger.warn('Identity bootstrap fetch failed', { status: res.status })
        return []
      }
      const events = await res.json() as SerendipEvent[]
      return Array.isArray(events) ? events : []
    } catch (err) {
      logger.error('Identity bootstrap fetch error', { error: err instanceof Error ? err.message : String(err) })
      return []
    }
  }

  /**
   * Pull events from a peer relay since a given timestamp.
   * Identity events are bootstrapped without time filter.
   * Other events are filtered by sinceMs.
   *
   * @param fetchFn - Fetch function (injected for testability)
   * @param relayOperatorKey - This relay's operator key (for signing sync requests)
   * @param sinceMs - Timestamp in milliseconds to pull events since
   */
  async syncFromPeer(
    fetchFn: FetchFn,
    relayOperatorKey: { publicKey: string },
    sinceMs: number
  ): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, skipped: 0, errors: 0 }

    // Step 1: Bootstrap identity events (no time filter)
    const identityEvents = await this.fetchIdentityBootstrap(fetchFn)
    for (const event of identityEvents) {
      const stored = await this.ingestSyncEvent(event)
      if (stored) result.synced++
      else result.skipped++
    }

    // Step 2: Pull regular events since sinceMs
    try {
      const res = await fetchFn(`/api/v1/sync?since=${sinceMs}`, {
        headers: {
          'X-Relay-Pubkey': relayOperatorKey.publicKey,
          'X-Relay-Signature': 'sync-request',
          'X-Relay-Timestamp': String(Math.floor(Date.now() / 1000)),
        },
      })

      if (!res.ok) {
        logger.warn('Peer sync fetch failed', { status: res.status })
        return result
      }

      const body = await res.json() as { events?: SerendipEvent[] }
      const events = body.events ?? []

      for (const event of events) {
        try {
          const stored = await this.ingestSyncEvent(event)
          if (stored) result.synced++
          else result.skipped++
        } catch {
          result.errors++
        }
      }
    } catch (err) {
      logger.error('Peer sync error', { error: err instanceof Error ? err.message : String(err) })
      result.errors++
    }

    return result
  }

  /**
   * Start the scheduled sync loop.
   * Pulls from all registered peers every SYNC_INTERVAL_MS.
   */
  startScheduler(fetchFn: FetchFn, thisRelayPubkey: string): void {
    if (this.schedulerHandle) {
      this.stopScheduler()
    }

    this.schedulerHandle = setInterval(async () => {
      const peers = this.nodeRegistry.listWithStatus()
      const sinceMs = Date.now() - SYNC_INTERVAL_MS

      for (const peer of peers) {
        if (peer.pubkey === thisRelayPubkey) continue // Don't sync from self
        logger.info('Scheduled sync from peer', { peer_url: peer.url })
        try {
          await this.syncFromPeer(
            (path, opts) => fetch(`${peer.url}${path}`, opts),
            { publicKey: thisRelayPubkey },
            sinceMs
          )
        } catch (err) {
          logger.error('Scheduled sync error', {
            peer_url: peer.url,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }, SYNC_INTERVAL_MS)
  }

  /** Stop the scheduler. */
  stopScheduler(): void {
    if (this.schedulerHandle) {
      clearInterval(this.schedulerHandle)
      this.schedulerHandle = null
    }
  }
}
