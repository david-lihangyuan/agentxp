// Plugin v3 local staging (02-data-model §7.2). This schema is
// implementation-private: it only has to round-trip the trace steps
// into a published reasoning_trace and survive relay outages.
import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'

export interface StagedTraceStep {
  id: number
  session_id: string
  step_index: number
  action: string
  outcome_short: string
  duration_ms: number
  created_at: number
}

export interface StagedExperience {
  id: number
  session_id: string
  reason: string
  data_json: string
  trace_json: string
  tags_json: string
  created_at: number
  retry_count: number
  last_attempt: number | null
  next_attempt_at: number
}

export interface PluginDb {
  appendTraceStep(row: Omit<StagedTraceStep, 'id'>): StagedTraceStep
  listTraceSteps(sessionId: string): StagedTraceStep[]
  clearTraceSteps(sessionId: string): void

  stageExperience(
    row: Omit<StagedExperience, 'id' | 'retry_count' | 'last_attempt'>,
  ): StagedExperience
  listDueExperiences(now: number): StagedExperience[]
  listAllExperiences(): StagedExperience[]
  markAttempt(id: number, now: number, nextAt: number): void
  removeExperience(id: number): void

  close(): void
}

export function openPluginDb(path: string): PluginDb {
  const db: DB = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      action TEXT NOT NULL,
      outcome_short TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trace_steps_session ON trace_steps(session_id, step_index);

    CREATE TABLE IF NOT EXISTS staged_experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      data_json TEXT NOT NULL,
      trace_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_attempt INTEGER,
      next_attempt_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_staged_due ON staged_experiences(next_attempt_at);
  `)

  const insertStep = db.prepare(
    `INSERT INTO trace_steps (session_id, step_index, action, outcome_short, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
  )
  const selectSteps = db.prepare(
    `SELECT * FROM trace_steps WHERE session_id = ? ORDER BY step_index ASC`,
  )
  const clearSteps = db.prepare(`DELETE FROM trace_steps WHERE session_id = ?`)

  const insertExp = db.prepare(
    `INSERT INTO staged_experiences
       (session_id, reason, data_json, trace_json, tags_json, created_at, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
  const selectDue = db.prepare(
    `SELECT * FROM staged_experiences WHERE next_attempt_at <= ? ORDER BY created_at ASC`,
  )
  const selectAll = db.prepare(`SELECT * FROM staged_experiences ORDER BY created_at ASC`)
  const updateAttempt = db.prepare(
    `UPDATE staged_experiences SET retry_count = retry_count + 1,
       last_attempt = ?, next_attempt_at = ? WHERE id = ?`,
  )
  const delExp = db.prepare(`DELETE FROM staged_experiences WHERE id = ?`)

  return {
    appendTraceStep(row) {
      return insertStep.get(
        row.session_id,
        row.step_index,
        row.action,
        row.outcome_short,
        row.duration_ms,
        row.created_at,
      ) as StagedTraceStep
    },
    listTraceSteps(sessionId) {
      return selectSteps.all(sessionId) as StagedTraceStep[]
    },
    clearTraceSteps(sessionId) {
      clearSteps.run(sessionId)
    },
    stageExperience(row) {
      return insertExp.get(
        row.session_id,
        row.reason,
        row.data_json,
        row.trace_json,
        row.tags_json,
        row.created_at,
        row.next_attempt_at,
      ) as StagedExperience
    },
    listDueExperiences(now) {
      return selectDue.all(now) as StagedExperience[]
    },
    listAllExperiences() {
      return selectAll.all() as StagedExperience[]
    },
    markAttempt(id, now, nextAt) {
      updateAttempt.run(now, nextAt, id)
    },
    removeExperience(id) {
      delExp.run(id)
    },
    close() {
      db.close()
    },
  }
}
