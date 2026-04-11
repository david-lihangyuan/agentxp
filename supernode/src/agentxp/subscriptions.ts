// Supernode AgentXP — Experience Subscriptions
// POST /api/v1/subscriptions: store query + pubkey
// Background job matches new experiences against subscriptions.
// GET /api/v1/subscriptions: list subscriptions for operator.

import { Database } from 'bun:sqlite'
import { logger } from '../logger'

export interface SubscriptionRecord {
  id: number
  pubkey: string
  operator_pubkey: string
  query: string
  tags: string | null
  created_at: number
  last_matched_at: number | null
}

export interface SubscriptionInput {
  pubkey: string
  operatorPubkey: string
  query: string
  tags?: string[]
}

export class SubscriptionManager {
  private matchInterval: ReturnType<typeof setInterval> | null = null
  private lastMatchedAt: number = 0

  constructor(private db: Database) {}

  /** Store a new subscription. */
  subscribe(input: SubscriptionInput): { ok: boolean; id?: number; error?: string } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO subscriptions (pubkey, operator_pubkey, query, tags, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      const result = stmt.run(
        input.pubkey,
        input.operatorPubkey,
        input.query,
        input.tags ? JSON.stringify(input.tags) : null,
        Math.floor(Date.now() / 1000)
      )

      return { ok: true, id: Number(result.lastInsertRowid) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
  }

  /** List all subscriptions for an operator. */
  listForOperator(operatorPubkey: string): SubscriptionRecord[] {
    return this.db
      .query('SELECT * FROM subscriptions WHERE operator_pubkey = ? ORDER BY created_at DESC')
      .all(operatorPubkey) as SubscriptionRecord[]
  }

  /** List all subscriptions for a pubkey. */
  listForPubkey(pubkey: string): SubscriptionRecord[] {
    return this.db
      .query('SELECT * FROM subscriptions WHERE pubkey = ? ORDER BY created_at DESC')
      .all(pubkey) as SubscriptionRecord[]
  }

  /** Delete a subscription by id. Only owner can delete. */
  delete(id: number, pubkey: string): { ok: boolean; error?: string } {
    const sub = this.db
      .query('SELECT * FROM subscriptions WHERE id = ?')
      .get(id) as SubscriptionRecord | null

    if (!sub) return { ok: false, error: 'subscription not found' }
    if (sub.pubkey !== pubkey) return { ok: false, error: 'unauthorized' }

    this.db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
    return { ok: true }
  }

  /** Check if a new experience matches any subscriptions and fire pulse events. */
  async matchNewExperience(
    experienceId: number,
    what: string,
    tried: string,
    learned: string,
    tags: string[],
    createdAt: number
  ): Promise<void> {
    const subs = this.db
      .query('SELECT * FROM subscriptions')
      .all() as SubscriptionRecord[]

    for (const sub of subs) {
      const matches = this.matchesSubscription(sub, what, tried, learned, tags)
      if (!matches) continue

      // Fire a pulse event for subscription match
      try {
        this.db
          .prepare(`
            INSERT INTO pulse_events (experience_id, type, from_pubkey, operator_pubkey, metadata, created_at)
            VALUES (?, 'subscription_match', ?, ?, ?, ?)
          `)
          .run(
            experienceId,
            null,
            sub.operator_pubkey,
            JSON.stringify({ subscription_id: sub.id, query: sub.query }),
            Math.floor(Date.now() / 1000)
          )

        // Update last_matched_at
        this.db
          .prepare('UPDATE subscriptions SET last_matched_at = ? WHERE id = ?')
          .run(Math.floor(Date.now() / 1000), sub.id)

        logger.info('Subscription match found', {
          subscription_id: sub.id,
          experience_id: experienceId,
          pubkey: sub.pubkey,
        })
      } catch (err) {
        logger.error('Failed to create subscription pulse', {
          subscription_id: sub.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  /** Check if an experience matches a subscription query. */
  private matchesSubscription(
    sub: SubscriptionRecord,
    what: string,
    tried: string,
    learned: string,
    tags: string[]
  ): boolean {
    const queryTerms = sub.query.toLowerCase().split(/\s+/).filter(Boolean)
    const text = `${what} ${tried} ${learned}`.toLowerCase()

    // Check all query terms appear in the experience text or tags
    const textMatches = queryTerms.every(
      (term) =>
        text.includes(term) ||
        tags.some((t) => t.toLowerCase().includes(term))
    )

    if (!textMatches) return false

    // Check tag filter if provided
    if (sub.tags) {
      try {
        const requiredTags = JSON.parse(sub.tags) as string[]
        const hasAllTags = requiredTags.every((rt) =>
          tags.some((t) => t.toLowerCase() === rt.toLowerCase())
        )
        if (!hasAllTags) return false
      } catch {
        // Ignore malformed tags
      }
    }

    return true
  }

  /** Start background subscription matching worker. */
  startMatchingWorker(intervalMs: number = 10_000): void {
    if (this.matchInterval) return
    this.matchInterval = setInterval(() => {
      void this.runMatchingJob()
    }, intervalMs)
  }

  /** Stop background worker. */
  stopMatchingWorker(): void {
    if (this.matchInterval) {
      clearInterval(this.matchInterval)
      this.matchInterval = null
    }
  }

  /** Run one cycle of the matching job. */
  async runMatchingJob(): Promise<void> {
    const since = this.lastMatchedAt
    this.lastMatchedAt = Math.floor(Date.now() / 1000)

    // Find new experiences since last run
    const newExperiences = this.db
      .query(`
        SELECT id, what, tried, learned, tags, created_at
        FROM experiences
        WHERE created_at >= ?
        ORDER BY created_at ASC
        LIMIT 100
      `)
      .all(since) as Array<{
        id: number; what: string; tried: string; learned: string;
        tags: string; created_at: number
      }>

    for (const exp of newExperiences) {
      const tags = (() => {
        try { return JSON.parse(exp.tags) as string[] }
        catch { return [] }
      })()

      await this.matchNewExperience(
        exp.id,
        exp.what,
        exp.tried,
        exp.learned,
        tags,
        exp.created_at
      )
    }
  }
}
