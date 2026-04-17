// Supernode AgentXP — Experience Store
// Processes intent.broadcast events with payload.type='experience'.
// Stores immediately with embedding_status='pending'.
// Async embedding queue processes in background.

import type Database from 'better-sqlite3'
import type { SerendipEvent, ExperienceData } from '@serendip/protocol'
import { CircuitBreaker } from '../circuit-breaker'
import { logger } from '../logger'

export interface ExperienceRecord {
  id: number
  event_id: string
  pubkey: string
  operator_pubkey: string
  what: string
  tried: string
  outcome: string
  learned: string
  tags: string
  visibility: string
  scope: string | null
  is_failure: number
  embedding: string | null
  embedding_status: string
  created_at: number
  indexed_at: number | null
}

export interface EmbeddingWorkerOptions {
  /** Function to generate embedding vector for text. */
  generateEmbedding?: (text: string) => Promise<number[]>
  /** Polling interval for background worker in ms. Default: 5000 */
  pollIntervalMs?: number
}

export class ExperienceStore {
  private embeddingQueue: Array<{ experienceId: number; text: string }> = []
  private workerRunning = false
  private workerInterval: ReturnType<typeof setInterval> | null = null
  private generateEmbedding: ((text: string) => Promise<number[]>) | null = null

  constructor(
    private db: Database.Database,
    private circuitBreaker: CircuitBreaker,
    opts: EmbeddingWorkerOptions = {}
  ) {
    this.generateEmbedding = opts.generateEmbedding ?? null
    if (opts.generateEmbedding && opts.pollIntervalMs !== 0) {
      this.startEmbeddingWorker(opts.pollIntervalMs ?? 5000)
    }
  }

  /** Store an experience from an intent.broadcast event. Returns experience id. */
  store(event: SerendipEvent): { ok: boolean; experienceId?: number; error?: string } {
    if (event.kind !== 'intent.broadcast') {
      return { ok: false, error: 'not an intent.broadcast event' }
    }

    const payload = event.payload as { type: string; data: Record<string, unknown> }
    if (payload.type !== 'experience') {
      return { ok: false, error: 'payload.type is not experience' }
    }

    // Payload shape validated by kind/type check above; cast via unknown
    // satisfies TS's structural-compatibility guard.
    const data = payload.data as unknown as ExperienceData

    // Circuit breaker check
    if (this.circuitBreaker.isOpen()) {
      return { ok: false, error: 'embedding queue circuit breaker open' }
    }

    const isFailure = data.outcome === 'failed' ? 1 : 0
    const scope = data.scope ? JSON.stringify(data.scope) : null
    const tags = JSON.stringify(event.tags)

    try {
      // Ensure event exists in events table (FK constraint)
      // Uses INSERT OR IGNORE so EventHandler's prior insert is not overwritten
      this.db
        .prepare(`
          INSERT OR IGNORE INTO events
            (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
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
          Math.floor(Date.now() / 1000)
        )

      const stmt = this.db.prepare(`
        INSERT INTO experiences
          (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, scope, is_failure, embedding_status, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT(event_id) DO NOTHING
      `)

      stmt.run(
        event.id,
        event.pubkey,
        event.operator_pubkey,
        data.what,
        data.tried,
        data.outcome,
        data.learned,
        tags,
        event.visibility,
        scope,
        isFailure,
        event.created_at
      )

      const experience = this.db
        .prepare('SELECT id FROM experiences WHERE event_id = ?')
        .get(event.id) as { id: number } | undefined

      if (!experience) {
        return { ok: false, error: 'failed to store experience' }
      }

      // Enqueue for embedding
      const embeddingText = `${data.what} ${data.tried} ${data.learned}`
      this.circuitBreaker.enqueue()
      this.embeddingQueue.push({ experienceId: experience.id, text: embeddingText })

      logger.info('Experience stored', {
        event_id: event.id,
        experience_id: experience.id,
        outcome: data.outcome,
        is_failure: isFailure,
      })

      return { ok: true, experienceId: experience.id }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Failed to store experience', { event_id: event.id, error: msg })
      return { ok: false, error: msg }
    }
  }

  /** Get queue depth. */
  getQueueDepth(): number {
    return this.embeddingQueue.length
  }

  /** Recover pending experiences from DB into memory queue on startup. */
  private recoverPendingFromDb(): void {
    try {
      const pending = this.db
        .prepare(
          `SELECT id, what, tried, learned FROM experiences WHERE embedding_status = 'pending'`
        )
        .all() as Array<{ id: number; what: string; tried: string; learned: string }>
      if (pending.length > 0) {
        for (const row of pending) {
          const text = `${row.what} ${row.tried} ${row.learned}`
          this.embeddingQueue.push({ experienceId: row.id, text })
        }
        logger.info('Recovered pending experiences into embedding queue', { count: pending.length })
      }
    } catch (err) {
      logger.error('Failed to recover pending experiences', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** Start the background embedding worker. */
  startEmbeddingWorker(intervalMs: number = 5000): void {
    if (this.workerInterval) return
    this.recoverPendingFromDb()
    this.workerInterval = setInterval(() => {
      void this.processEmbeddingQueue()
    }, intervalMs)
  }

  /** Stop the background worker. */
  stopEmbeddingWorker(): void {
    if (this.workerInterval) {
      clearInterval(this.workerInterval)
      this.workerInterval = null
    }
  }

  /** Process one batch of embedding queue items. */
  async processEmbeddingQueue(): Promise<void> {
    if (!this.generateEmbedding || this.workerRunning) return
    if (this.embeddingQueue.length === 0) return

    this.workerRunning = true
    try {
      // Process up to 10 items per batch
      const batch = this.embeddingQueue.splice(0, 10)
      for (const item of batch) {
        try {
          const embedding = await this.generateEmbedding(item.text)
          this.db
            .prepare(`
              UPDATE experiences
              SET embedding = ?, embedding_status = 'indexed', indexed_at = ?
              WHERE id = ?
            `)
            .run(JSON.stringify(embedding), Math.floor(Date.now() / 1000), item.experienceId)
          this.circuitBreaker.dequeue()
        } catch (err) {
          logger.error('Embedding generation failed', {
            experience_id: item.experienceId,
            error: err instanceof Error ? err.message : String(err),
          })
          this.db
            .prepare("UPDATE experiences SET embedding_status = 'failed' WHERE id = ?")
            .run(item.experienceId)
          this.circuitBreaker.dequeue()
        }
      }
    } finally {
      this.workerRunning = false
    }
  }

  /** Get an experience by event_id. */
  getByEventId(eventId: string): ExperienceRecord | undefined {
    return this.db
      .prepare('SELECT * FROM experiences WHERE event_id = ?')
      .get(eventId) as ExperienceRecord | undefined
  }

  /** Manually trigger embedding for testing. */
  async processAllPending(): Promise<void> {
    while (this.embeddingQueue.length > 0) {
      await this.processEmbeddingQueue()
    }
  }
}
