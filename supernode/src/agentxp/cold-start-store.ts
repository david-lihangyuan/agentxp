// Supernode AgentXP — Cold Start Event Store
// Receives and routes cold-start protocol events:
//   intent.question, experience.solution, verification.pass, verification.fail

import type Database from 'better-sqlite3'
import type { SerendipEvent } from '@serendip/protocol'

const SUPPORTED_KINDS = new Set([
  'intent.question',
  'experience.solution',
  'verification.pass',
  'verification.fail',
])

export interface QuestionRow {
  id: number
  event_id: string
  kind: string
  pubkey: string
  created_at: number
  payload: string
  tags: string
  sig: string
  status: string
  received_at: number
}

export type SolutionRow = QuestionRow

export class ColdStartStore {
  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cold_start_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        tags TEXT NOT NULL,
        sig TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        received_at INTEGER NOT NULL
      )
    `)
  }

  /** Store a cold-start event. Idempotent — duplicate event_id returns ok:true. */
  store(event: SerendipEvent): { ok: boolean; error?: string } {
    if (!SUPPORTED_KINDS.has(event.kind)) {
      return { ok: false, error: 'unsupported kind' }
    }

    try {
      this.db
        .prepare(
          `INSERT INTO cold_start_events
            (event_id, kind, pubkey, created_at, payload, tags, sig, status, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
        )
        .run(
          event.id,
          event.kind,
          event.pubkey,
          event.created_at,
          JSON.stringify(event.payload),
          JSON.stringify(event.tags),
          event.sig,
          Math.floor(Date.now() / 1000)
        )
    } catch (err) {
      // UNIQUE constraint on event_id — treat as idempotent success
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('UNIQUE constraint failed')) {
        return { ok: true }
      }
      return { ok: false, error: msg }
    }

    return { ok: true }
  }

  /** List intent.question events, optionally filtered by status. */
  listQuestions(opts: { status?: string; limit?: number } = {}): QuestionRow[] {
    const limit = opts.limit ?? 50
    if (opts.status) {
      return this.db
        .prepare(
          `SELECT * FROM cold_start_events
           WHERE kind = 'intent.question' AND status = ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(opts.status, limit) as QuestionRow[]
    }
    return this.db
      .prepare(
        `SELECT * FROM cold_start_events
         WHERE kind = 'intent.question'
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as QuestionRow[]
  }

  /** List experience.solution events, optionally filtered by status. */
  listSolutions(opts: { status?: string; limit?: number } = {}): SolutionRow[] {
    const limit = opts.limit ?? 50
    if (opts.status) {
      return this.db
        .prepare(
          `SELECT * FROM cold_start_events
           WHERE kind = 'experience.solution' AND status = ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(opts.status, limit) as SolutionRow[]
    }
    return this.db
      .prepare(
        `SELECT * FROM cold_start_events
         WHERE kind = 'experience.solution'
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as SolutionRow[]
  }

  /** Update status of a cold-start event by event_id. */
  updateStatus(eventId: string, status: string): { ok: boolean; error?: string } {
    const validStatuses = ['pending', 'solving', 'solved', 'verified', 'verified_pass', 'verified_fail', 'failed', 'published']
    if (!validStatuses.includes(status)) {
      return { ok: false, error: `invalid status: ${status}` }
    }
    const result = this.db
      .prepare('UPDATE cold_start_events SET status = ? WHERE event_id = ?')
      .run(status, eventId)
    if (result.changes === 0) {
      return { ok: false, error: 'event not found' }
    }
    return { ok: true }
  }

  /** Find solutions for a specific question (by question event_id in payload). */
  findSolutionsForQuestion(questionEventId: string): SolutionRow[] {
    // Search both exact JSON match and partial match for robustness
    return this.db
      .prepare(
        `SELECT * FROM cold_start_events
         WHERE kind = 'experience.solution'
         AND (
           json_extract(payload, '$.data.question_id') = ?
           OR payload LIKE ?
         )
         ORDER BY created_at DESC`
      )
      .all(questionEventId, `%${questionEventId}%`) as SolutionRow[]
  }

  /** Find verifications for a specific solution (by solution event_id in payload). */
  findVerificationsForSolution(solutionEventId: string): QuestionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM cold_start_events
         WHERE kind IN ('verification.pass', 'verification.fail')
         AND payload LIKE ?
         ORDER BY created_at DESC`
      )
      .all(`%"solution_id":"${solutionEventId}"%`) as QuestionRow[]
  }

  /** Check if a Stack Overflow question ID has already been posted. */
  isQuestionPosted(soQuestionId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM cold_start_events
         WHERE kind = 'intent.question'
         AND (payload LIKE ? OR payload LIKE ?)
         LIMIT 1`
      )
      .get(`%"so_id":"${soQuestionId}"%`, `%"so_id":${soQuestionId}%`)
    return !!row
  }

  /** Claim a question for solving (prevents duplicate work). Returns true if claimed successfully. */
  claimForSolving(questionEventId: string, solverPubkey: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE cold_start_events
         SET status = 'solving'
         WHERE event_id = ? AND kind = 'intent.question' AND status = 'pending'`
      )
      .run(questionEventId)
    return result.changes > 0
  }

  /** Process verification results: update question status based on verification outcome. */
  processVerification(solutionEventId: string, passed: boolean): { ok: boolean; error?: string } {
    // Find the solution to get the question_id
    const solution = this.db
      .prepare('SELECT payload FROM cold_start_events WHERE event_id = ?')
      .get(solutionEventId) as { payload: string } | undefined
    if (!solution) return { ok: false, error: 'solution not found' }

    let questionId: string | undefined
    try {
      const p = JSON.parse(solution.payload)
      questionId = p?.data?.question_id
    } catch { /* ignore */ }

    if (passed) {
      // Mark solution as verified
      this.db.prepare("UPDATE cold_start_events SET status = 'verified' WHERE event_id = ?").run(solutionEventId)
      // Mark question as verified too
      if (questionId) {
        this.db.prepare("UPDATE cold_start_events SET status = 'verified' WHERE event_id = ?").run(questionId)
      }
    } else {
      // Mark solution as failed
      this.db.prepare("UPDATE cold_start_events SET status = 'failed' WHERE event_id = ?").run(solutionEventId)
      // Reopen question for retry
      if (questionId) {
        this.db.prepare("UPDATE cold_start_events SET status = 'pending' WHERE event_id = ?").run(questionId)
      }
    }
    return { ok: true }
  }

  /** Get pipeline stats. */
  getStats(): { questions: number; solutions: number; verified: number; failed: number; pending_questions: number } {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM cold_start_events WHERE kind = 'intent.question') as questions,
        (SELECT COUNT(*) FROM cold_start_events WHERE kind = 'experience.solution') as solutions,
        (SELECT COUNT(*) FROM cold_start_events WHERE status = 'verified') as verified,
        (SELECT COUNT(*) FROM cold_start_events WHERE kind = 'experience.solution' AND status = 'failed') as failed,
        (SELECT COUNT(*) FROM cold_start_events WHERE kind = 'intent.question' AND status = 'pending') as pending_questions
    `).get() as any
    return row
  }
}
