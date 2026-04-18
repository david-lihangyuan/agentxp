// Supernode AgentXP — Experience Subscriptions
// POST /api/v1/subscriptions: store query + pubkey
// Background matcher fires pulse_event on match
// GET /api/v1/subscriptions: list subscriptions

import type Database from 'better-sqlite3'
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

export class SubscriptionManager {
  private lastMatchedAt: number = 0
  private matchInterval: ReturnType<typeof setInterval> | null = null

  constructor(private db: Database.Database) {}

  /** Subscribe an agent to future experience matches. */
  subscribe(input: {
    pubkey: string
    operatorPubkey: string
    query: string
    tags?: string[]
  }): { ok: boolean; id?: number; error?: string } {
    if (!input.pubkey || !input.query) {
      return { ok: false, error: 'pubkey and query are required' }
    }

    const now = Math.floor(Date.now() / 1000)

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
        now
      )

      return { ok: true, id: result.lastInsertRowid as number }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Failed to create subscription', { error: msg })
      return { ok: false, error: msg }
    }
  }

  /** List subscriptions for an operator. */
  listForOperator(operatorPubkey: string): SubscriptionRecord[] {
    return this.db
      .prepare('SELECT * FROM subscriptions WHERE operator_pubkey = ? ORDER BY created_at DESC')
      .all(operatorPubkey) as SubscriptionRecord[]
  }

  /** List subscriptions for a specific agent pubkey. */
  listForPubkey(pubkey: string): SubscriptionRecord[] {
    return this.db
      .prepare('SELECT * FROM subscriptions WHERE pubkey = ? ORDER BY created_at DESC')
      .all(pubkey) as SubscriptionRecord[]
  }

  /**
   * Match a new experience against all active subscriptions.
   * Fires pulse_events for matching subscriptions.
   */
  async matchNewExperience(
    experienceId: number,
    what: string,
    tried: string,
    learned: string,
    tags: string[],
    createdAt: number
  ): Promise<void> {
    const subs = this.db
      .prepare('SELECT * FROM subscriptions')
      .all() as SubscriptionRecord[]

    const now = Math.floor(Date.now() / 1000)

    for (const sub of subs) {
      if (this.matches(sub, what, tried, learned, tags)) {
        try {
          this.db.prepare(`
            INSERT INTO pulse_events (experience_id, operator_pubkey, type, metadata, created_at)
            VALUES (?, ?, 'subscription_match', ?, ?)
          `).run(
            experienceId,
            sub.operator_pubkey,
            JSON.stringify({
              subscription_id: sub.id,
              subscriber_pubkey: sub.pubkey,
              query: sub.query,
              matched_what: what,
              matched_tags: tags,
            }),
            now
          )

          // Update subscription's last_matched_at
          this.db.prepare('UPDATE subscriptions SET last_matched_at = ? WHERE id = ?')
            .run(now, sub.id)

          logger.info('Subscription match', {
            subscription_id: sub.id,
            experience_id: experienceId,
          })
        } catch (err) {
          logger.error('Failed to create pulse event', {
            subscription_id: sub.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  }

  /** Check if an experience matches a subscription. */
  private matches(
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
      .prepare(`
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
