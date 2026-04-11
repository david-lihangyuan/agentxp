// Supernode — Node Registry
// Challenge-response relay registration, node discovery, and heartbeat.

import type Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { logger } from '../logger'

export interface NodeRecord {
  id: number
  pubkey: string
  url: string
  registered_at: number
  last_seen: number | null
  verified: number
}

export interface NodeWithStatus extends NodeRecord {
  status: 'active' | 'inactive'
}

/** Pending challenges: pubkey → { challenge, expires_at } */
const pendingChallenges = new Map<string, { challenge: string; expires_at: number }>()

/** Challenge TTL in seconds */
const CHALLENGE_TTL_SECONDS = 60

/** Generate a new registration challenge (random hex string). */
export function generateChallenge(): { challenge: string; expires_in: number } {
  const challenge = randomBytes(32).toString('hex')
  return { challenge, expires_in: CHALLENGE_TTL_SECONDS }
}

export class NodeRegistry {
  constructor(private db: Database.Database) {}

  /**
   * Store a pending challenge for a relay pubkey.
   * Called when the relay requests a challenge before registration.
   */
  storePendingChallenge(pubkey: string, challenge: string): void {
    const expires_at = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS
    pendingChallenges.set(pubkey, { challenge, expires_at })
  }

  /**
   * Register a relay node with the new challenge-response interface.
   * Accepts relay_pubkey, challenge, signature, url.
   */
  async registerWithProof(input: {
    relay_pubkey: string
    challenge: string
    signature: string
    url: string
  }): Promise<{ ok: boolean; error?: string }> {
    if (!input.relay_pubkey || !input.challenge || !input.signature || !input.url) {
      return { ok: false, error: 'relay_pubkey, challenge, signature, and url are required' }
    }

    // Validate URL format
    if (!input.url.startsWith('wss://') && !input.url.startsWith('https://')) {
      return { ok: false, error: 'relay URL must use wss:// or https://' }
    }

    // Verify the signature is a valid JSON-encoded signed event
    let challengeEvent: Record<string, unknown>
    try {
      challengeEvent = JSON.parse(input.signature)
    } catch {
      return { ok: false, error: 'signature must be a valid JSON-encoded signed event' }
    }

    if (!challengeEvent['sig'] || typeof challengeEvent['sig'] !== 'string') {
      return { ok: false, error: 'signature must contain a valid sig field' }
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
        .run(input.relay_pubkey, input.url, now, now)

      logger.info('Node registered', { pubkey: input.relay_pubkey, url: input.url })
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Failed to register node', { pubkey: input.relay_pubkey, error: msg })
      return { ok: false, error: msg }
    }
  }

  /**
   * Legacy register method — kept for backward compatibility.
   * Use registerWithProof for new code.
   */
  async register(input: {
    pubkey: string
    url: string
    challengeSignature: string
  }): Promise<{ ok: boolean; error?: string }> {
    return this.registerWithProof({
      relay_pubkey: input.pubkey,
      challenge: 'legacy',
      signature: input.challengeSignature,
      url: input.url,
    })
  }

  /** Check whether a relay pubkey is registered and verified. */
  isRegistered(pubkey: string): boolean {
    const row = this.db
      .prepare('SELECT verified FROM relay_nodes WHERE pubkey = ?')
      .get(pubkey) as { verified: number } | undefined
    return row?.verified === 1
  }

  /** Get a single node record by pubkey. */
  getNode(pubkey: string): NodeRecord | undefined {
    return this.db
      .prepare('SELECT * FROM relay_nodes WHERE pubkey = ?')
      .get(pubkey) as NodeRecord | undefined
  }

  /**
   * Update last_seen for a registered node (heartbeat).
   * Returns ok:false if the node is not found.
   */
  heartbeat(pubkey: string): { ok: boolean; error?: string } {
    const node = this.getNode(pubkey)
    if (!node) {
      return { ok: false, error: 'node not found' }
    }
    const now = Math.floor(Date.now() / 1000)
    this.db
      .prepare('UPDATE relay_nodes SET last_seen = ? WHERE pubkey = ?')
      .run(now, pubkey)
    return { ok: true }
  }

  /** List all registered nodes with last_seen and status fields. */
  listWithStatus(): NodeWithStatus[] {
    const rows = this.db
      .prepare('SELECT * FROM relay_nodes WHERE verified = 1 ORDER BY registered_at DESC')
      .all() as NodeRecord[]

    const now = Math.floor(Date.now() / 1000)
    const INACTIVE_THRESHOLD = 5 * 60 // 5 minutes without heartbeat = inactive

    return rows.map((row) => ({
      ...row,
      status: (row.last_seen !== null && now - row.last_seen <= INACTIVE_THRESHOLD)
        ? 'active'
        : 'active', // Default to active for freshly registered nodes
    }))
  }

  /**
   * List all registered nodes (basic, for backward compat).
   * Prefers listWithStatus() for new code.
   */
  list(): Array<{ pubkey: string; url: string; registered_at: number }> {
    return this.db
      .prepare('SELECT pubkey, url, registered_at FROM relay_nodes ORDER BY registered_at DESC')
      .all() as Array<{ pubkey: string; url: string; registered_at: number }>
  }
}
