/**
 * db.ts — SQLite storage layer for AgentXP plugin.
 *
 * Schema: local_lessons (FTS5), trace_steps, feedback,
 * published_log, injection_log, context_cache.
 */

import Database from 'better-sqlite3'

export type Db = ReturnType<typeof createDb>

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Lesson {
  id?: number
  what: string
  tried: string
  outcome: string
  learned: string
  source?: string        // 'local' | 'network'
  tags?: string[]        // stored as JSON
  relevanceScore?: number
  appliedCount?: number
  successCount?: number
  createdAt?: number
  updatedAt?: number
  outdated?: boolean
  embedding?: Buffer | null
}

export interface LessonRow {
  id: number
  what: string
  tried: string
  outcome: string
  learned: string
  source: string
  tags: string           // JSON string
  relevance_score: number
  applied_count: number
  success_count: number
  created_at: number
  updated_at: number
  outdated: number
  embedding: Buffer | null
}

export interface TraceStep {
  id?: number
  sessionId: string
  action: string
  toolName?: string
  significance?: string  // 'routine' | 'significant' | 'error'
  errorSignature?: string
  durationMs?: number
  timestamp?: number
}

export interface Feedback {
  id?: number
  lessonId: number
  type: string           // 'cited' | 'verified' | 'contradicted' | 'outdated'
  sessionId?: string
  comment?: string
  createdAt?: number
}

export interface PublishedLog {
  id?: number
  lessonId: number
  relayEventId?: string
  publishedAt?: number
  unpublishedAt?: number | null
}

export interface InjectionLog {
  id?: number
  sessionId: string
  injected: boolean
  tokenCount?: number
  lessonIds?: number[]
  createdAt?: number
}

export interface ContextCache {
  sessionId: string
  keywords: string[]
  updatedAt?: number
}

// ─── FTS5 Helpers ──────────────────────────────────────────────────────────

/**
 * Sanitize a raw FTS5 query string.
 * Only keeps alphanumeric, spaces, and CJK characters.
 * Strips FTS5 operators (AND, OR, NOT, NEAR) and special chars (* " : ^ ~ etc.)
 */
export function sanitizeFtsQuery(raw: string): string {
  // Remove FTS5 operators (word-boundary match)
  const noOps = raw.replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')
  // Only keep alphanumeric, space, and CJK character ranges
  const cleaned = noOps
    .replace(/[^a-zA-Z0-9\s\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned
}

/**
 * Detect FTS5 availability at runtime.
 * Falls back gracefully on SQLite builds without FTS5.
 */
function hasFts5(db: Database.Database): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(x)')
    db.exec('DROP TABLE IF EXISTS _fts5_probe')
    return true
  } catch {
    return false
  }
}

// ─── Schema ────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
-- Lessons
CREATE TABLE IF NOT EXISTS local_lessons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  what            TEXT    NOT NULL,
  tried           TEXT    NOT NULL,
  outcome         TEXT    NOT NULL,
  learned         TEXT    NOT NULL,
  source          TEXT    NOT NULL DEFAULT 'local',
  tags            TEXT    DEFAULT '[]',
  relevance_score REAL    DEFAULT 0,
  applied_count   INTEGER DEFAULT 0,
  success_count   INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  outdated        INTEGER DEFAULT 0,
  embedding       BLOB
);

-- Trace steps (only toolName + action, NO raw params)
CREATE TABLE IF NOT EXISTS trace_steps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT    NOT NULL,
  action          TEXT    NOT NULL,
  tool_name       TEXT,
  significance    TEXT    DEFAULT 'routine',
  error_signature TEXT,
  duration_ms     INTEGER,
  timestamp       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trace_session ON trace_steps(session_id);

-- Feedback
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id   INTEGER NOT NULL,
  type        TEXT    NOT NULL,
  session_id  TEXT,
  comment     TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_lesson ON feedback(lesson_id);

-- Published log
CREATE TABLE IF NOT EXISTS published_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id       INTEGER NOT NULL,
  relay_event_id  TEXT,
  published_at    INTEGER NOT NULL,
  unpublished_at  INTEGER
);

-- Injection log
CREATE TABLE IF NOT EXISTS injection_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  injected    INTEGER NOT NULL,
  token_count INTEGER DEFAULT 0,
  lesson_ids  TEXT    DEFAULT '[]',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_injection_session ON injection_log(session_id);

-- Context keyword cache (UPSERT by session_id)
CREATE TABLE IF NOT EXISTS context_cache (
  session_id  TEXT    PRIMARY KEY,
  keywords    TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);
`

const FTS5_SCHEMA_SQL = `
-- FTS5 full-text index
CREATE VIRTUAL TABLE IF NOT EXISTS local_lessons_fts USING fts5(
  what, tried, outcome, learned, tags,
  content='local_lessons',
  content_rowid='id'
);

-- Triggers to keep FTS5 in sync
CREATE TRIGGER IF NOT EXISTS lessons_ai AFTER INSERT ON local_lessons BEGIN
  INSERT INTO local_lessons_fts(rowid, what, tried, outcome, learned, tags)
  VALUES (new.id, new.what, new.tried, new.outcome, new.learned, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS lessons_ad AFTER DELETE ON local_lessons BEGIN
  INSERT INTO local_lessons_fts(local_lessons_fts, rowid, what, tried, outcome, learned, tags)
  VALUES ('delete', old.id, old.what, old.tried, old.outcome, old.learned, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS lessons_au AFTER UPDATE ON local_lessons BEGIN
  INSERT INTO local_lessons_fts(local_lessons_fts, rowid, what, tried, outcome, learned, tags)
  VALUES ('delete', old.id, old.what, old.tried, old.outcome, old.learned, old.tags);
  INSERT INTO local_lessons_fts(rowid, what, tried, outcome, learned, tags)
  VALUES (new.id, new.what, new.tried, new.outcome, new.learned, new.tags);
END;
`

// ─── Row ↔ Domain converters ───────────────────────────────────────────────

function rowToLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    what: row.what,
    tried: row.tried,
    outcome: row.outcome,
    learned: row.learned,
    source: row.source,
    tags: JSON.parse(row.tags ?? '[]') as string[],
    relevanceScore: row.relevance_score,
    appliedCount: row.applied_count,
    successCount: row.success_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    outdated: row.outdated === 1,
    embedding: row.embedding,
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createDb(dbPath: string = ':memory:') {
  const db = new Database(dbPath)

  // WAL mode for better concurrency
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(SCHEMA_SQL)

  const fts5Available = hasFts5(db)
  if (fts5Available) {
    db.exec(FTS5_SCHEMA_SQL)
  }

  // ── Lessons ──────────────────────────────────────────────────────────────

  const stmtInsertLesson = db.prepare<[string, string, string, string, string, string, number, number]>(`
    INSERT INTO local_lessons (what, tried, outcome, learned, source, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const stmtGetLesson = db.prepare<[number]>(`
    SELECT * FROM local_lessons WHERE id = ?
  `)

  const stmtUpdateLessonCounts = db.prepare<[number, number, number, number]>(`
    UPDATE local_lessons
    SET applied_count = applied_count + ?,
        success_count = success_count + ?,
        updated_at = ?
    WHERE id = ?
  `)

  const stmtMarkOutdated = db.prepare<[number, number]>(`
    UPDATE local_lessons SET outdated = 1, updated_at = ? WHERE id = ?
  `)

  const stmtDeleteLesson = db.prepare<[number]>(`
    DELETE FROM local_lessons WHERE id = ?
  `)

  const stmtListLessons = db.prepare(`
    SELECT * FROM local_lessons WHERE outdated = 0 ORDER BY relevance_score DESC, created_at DESC LIMIT ?
  `)

  const stmtListLessonsPaginated = db.prepare(`
    SELECT * FROM local_lessons WHERE outdated = 0 ORDER BY relevance_score DESC, created_at DESC LIMIT ? OFFSET ?
  `)

  function insertLesson(lesson: Omit<Lesson, 'id'>): number {
    const now = Date.now()
    const result = stmtInsertLesson.run(
      lesson.what,
      lesson.tried,
      lesson.outcome,
      lesson.learned,
      lesson.source ?? 'local',
      JSON.stringify(lesson.tags ?? []),
      lesson.createdAt ?? now,
      lesson.updatedAt ?? now,
    )
    return Number(result.lastInsertRowid)
  }

  function getLesson(id: number): Lesson | null {
    const row = stmtGetLesson.get(id) as LessonRow | undefined
    return row ? rowToLesson(row) : null
  }

  function markOutdated(id: number): void {
    stmtMarkOutdated.run(Date.now(), id)
  }

  function deleteLesson(id: number): void {
    stmtDeleteLesson.run(id)
  }

  function listLessons(limit = 50): Lesson[] {
    const rows = stmtListLessons.all(limit) as LessonRow[]
    return rows.map(rowToLesson)
  }

  function listLessonsPaginated(offset: number, limit: number): Lesson[] {
    const rows = stmtListLessonsPaginated.all(limit, offset) as LessonRow[]
    return rows.map(rowToLesson)
  }

  function incrementApplied(id: number, success: boolean): void {
    stmtUpdateLessonCounts.run(1, success ? 1 : 0, Date.now(), id)
  }

  // ── Search ───────────────────────────────────────────────────────────────

  function searchLessons(query: string, maxResults = 10): Lesson[] {
    if (!query.trim()) return []

    if (fts5Available) {
      const safeQuery = sanitizeFtsQuery(query)
      if (!safeQuery) return []

      // FTS5 MATCH query: each word becomes a prefix match
      const ftsQuery = safeQuery
        .split(/\s+/)
        .filter(Boolean)
        .map(w => `"${w}"`)
        .join(' ')

      const rows = db.prepare(`
        SELECT ll.*
        FROM local_lessons ll
        JOIN local_lessons_fts ON ll.id = local_lessons_fts.rowid
        WHERE local_lessons_fts MATCH ? AND ll.outdated = 0
        ORDER BY local_lessons_fts.rank
        LIMIT ?
      `).all(ftsQuery, maxResults) as LessonRow[]

      return rows.map(rowToLesson)
    } else {
      // Fallback: LIKE search
      const like = `%${query.replace(/[%_]/g, '\\$&')}%`
      const rows = db.prepare(`
        SELECT * FROM local_lessons
        WHERE outdated = 0
          AND (what LIKE ? ESCAPE '\\' OR tried LIKE ? ESCAPE '\\' OR learned LIKE ? ESCAPE '\\')
        ORDER BY relevance_score DESC, created_at DESC
        LIMIT ?
      `).all(like, like, like, maxResults) as LessonRow[]

      return rows.map(rowToLesson)
    }
  }

  // ── Trace Steps ──────────────────────────────────────────────────────────

  const stmtInsertTrace = db.prepare<[string, string, string | null, string, string | null, number | null, number]>(`
    INSERT INTO trace_steps (session_id, action, tool_name, significance, error_signature, duration_ms, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const stmtGetTracesBySession = db.prepare<[string]>(`
    SELECT * FROM trace_steps WHERE session_id = ? ORDER BY timestamp ASC
  `)

  const stmtDeleteTracesBySession = db.prepare<[string]>(`
    DELETE FROM trace_steps WHERE session_id = ?
  `)

  function insertTraceStep(step: TraceStep): number {
    const result = stmtInsertTrace.run(
      step.sessionId,
      step.action,
      step.toolName ?? null,
      step.significance ?? 'routine',
      step.errorSignature ?? null,
      step.durationMs ?? null,
      step.timestamp ?? Date.now(),
    )
    return Number(result.lastInsertRowid)
  }

  function getTraceSteps(sessionId: string): TraceStep[] {
    const rows = stmtGetTracesBySession.all(sessionId) as Array<{
      id: number
      session_id: string
      action: string
      tool_name: string | null
      significance: string
      error_signature: string | null
      duration_ms: number | null
      timestamp: number
    }>
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      action: r.action,
      toolName: r.tool_name ?? undefined,
      significance: r.significance,
      errorSignature: r.error_signature ?? undefined,
      durationMs: r.duration_ms ?? undefined,
      timestamp: r.timestamp,
    }))
  }

  function deleteTraceSteps(sessionId: string): void {
    stmtDeleteTracesBySession.run(sessionId)
  }

  // ── Feedback ─────────────────────────────────────────────────────────────

  const stmtInsertFeedback = db.prepare<[number, string, string | null, string | null, number]>(`
    INSERT INTO feedback (lesson_id, type, session_id, comment, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  const stmtGetFeedbackByLesson = db.prepare<[number]>(`
    SELECT * FROM feedback WHERE lesson_id = ? ORDER BY created_at DESC
  `)

  function insertFeedback(fb: Feedback): number {
    const result = stmtInsertFeedback.run(
      fb.lessonId,
      fb.type,
      fb.sessionId ?? null,
      fb.comment ?? null,
      fb.createdAt ?? Date.now(),
    )
    return Number(result.lastInsertRowid)
  }

  function getFeedbackForLesson(lessonId: number): Feedback[] {
    const rows = stmtGetFeedbackByLesson.all(lessonId) as Array<{
      id: number
      lesson_id: number
      type: string
      session_id: string | null
      comment: string | null
      created_at: number
    }>
    return rows.map(r => ({
      id: r.id,
      lessonId: r.lesson_id,
      type: r.type,
      sessionId: r.session_id ?? undefined,
      comment: r.comment ?? undefined,
      createdAt: r.created_at,
    }))
  }

  // ── Published Log ────────────────────────────────────────────────────────

  const stmtInsertPublished = db.prepare<[number, string | null, number]>(`
    INSERT INTO published_log (lesson_id, relay_event_id, published_at)
    VALUES (?, ?, ?)
  `)

  const stmtMarkUnpublished = db.prepare<[number, number]>(`
    UPDATE published_log SET unpublished_at = ? WHERE lesson_id = ? AND unpublished_at IS NULL
  `)

  const stmtGetPublishedByLesson = db.prepare<[number]>(`
    SELECT * FROM published_log WHERE lesson_id = ? ORDER BY published_at DESC
  `)

  function insertPublishedLog(entry: PublishedLog): number {
    const result = stmtInsertPublished.run(
      entry.lessonId,
      entry.relayEventId ?? null,
      entry.publishedAt ?? Date.now(),
    )
    return Number(result.lastInsertRowid)
  }

  function markUnpublished(lessonId: number): void {
    stmtMarkUnpublished.run(Date.now(), lessonId)
  }

  function getPublishedLog(lessonId: number): PublishedLog[] {
    const rows = stmtGetPublishedByLesson.all(lessonId) as Array<{
      id: number
      lesson_id: number
      relay_event_id: string | null
      published_at: number
      unpublished_at: number | null
    }>
    return rows.map(r => ({
      id: r.id,
      lessonId: r.lesson_id,
      relayEventId: r.relay_event_id ?? undefined,
      publishedAt: r.published_at,
      unpublishedAt: r.unpublished_at ?? undefined,
    }))
  }

  // ── Injection Log ────────────────────────────────────────────────────────

  const stmtInsertInjection = db.prepare<[string, number, number, string, number]>(`
    INSERT INTO injection_log (session_id, injected, token_count, lesson_ids, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  function insertInjectionLog(entry: InjectionLog): number {
    const result = stmtInsertInjection.run(
      entry.sessionId,
      entry.injected ? 1 : 0,
      entry.tokenCount ?? 0,
      JSON.stringify(entry.lessonIds ?? []),
      entry.createdAt ?? Date.now(),
    )
    return Number(result.lastInsertRowid)
  }

  // ── Context Cache ────────────────────────────────────────────────────────

  const stmtUpsertContext = db.prepare<[string, string, number]>(`
    INSERT INTO context_cache (session_id, keywords, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      keywords = excluded.keywords,
      updated_at = excluded.updated_at
  `)

  const stmtGetContext = db.prepare<[string]>(`
    SELECT * FROM context_cache WHERE session_id = ?
  `)

  const stmtDeleteContext = db.prepare<[string]>(`
    DELETE FROM context_cache WHERE session_id = ?
  `)

  function upsertContextCache(entry: ContextCache): void {
    stmtUpsertContext.run(
      entry.sessionId,
      JSON.stringify(entry.keywords),
      entry.updatedAt ?? Date.now(),
    )
  }

  function getContextCache(sessionId: string): ContextCache | null {
    const row = stmtGetContext.get(sessionId) as {
      session_id: string
      keywords: string
      updated_at: number
    } | undefined
    if (!row) return null
    return {
      sessionId: row.session_id,
      keywords: JSON.parse(row.keywords) as string[],
      updatedAt: row.updated_at,
    }
  }

  function deleteContextCache(sessionId: string): void {
    stmtDeleteContext.run(sessionId)
  }

  // ── Service helpers ───────────────────────────────────────────────────────

  function getLessonCount(): number {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM local_lessons WHERE outdated = 0').get() as { cnt: number }
    return row.cnt
  }

  function getNewLessonCount(sinceMsAgo = 30 * 60 * 1000): number {
    const cutoff = Date.now() - sinceMsAgo
    const row = db.prepare('SELECT COUNT(*) as cnt FROM local_lessons WHERE outdated = 0 AND created_at > ?').get(cutoff) as { cnt: number }
    return row.cnt
  }

  function listLessonsForDistillation(minGroupSize = 5): Array<{ tag: string; lessons: Lesson[] }> {
    // Find tags that have >= minGroupSize non-outdated lessons
    const rows = db.prepare(`
      SELECT id, what, tried, outcome, learned, source, tags, relevance_score,
             applied_count, success_count, created_at, updated_at, outdated, embedding
      FROM local_lessons WHERE outdated = 0
    `).all() as LessonRow[]

    const tagMap = new Map<string, Lesson[]>()
    for (const row of rows) {
      const lesson = rowToLesson(row)
      const tags = lesson.tags ?? []
      for (const tag of tags) {
        const existing = tagMap.get(tag) ?? []
        existing.push(lesson)
        tagMap.set(tag, existing)
      }
    }

    const groups: Array<{ tag: string; lessons: Lesson[] }> = []
    for (const [tag, lessons] of tagMap) {
      if (lessons.length >= minGroupSize) {
        groups.push({ tag, lessons })
      }
    }
    return groups
  }

  function hasPublished(): boolean {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM published_log WHERE unpublished_at IS NULL').get() as { cnt: number }
    return row.cnt > 0
  }

  function hasNewTraces(sinceMsAgo = 60 * 60 * 1000): boolean {
    const cutoff = Date.now() - sinceMsAgo
    const row = db.prepare('SELECT COUNT(*) as cnt FROM trace_steps WHERE timestamp > ?').get(cutoff) as { cnt: number }
    return row.cnt > 0
  }

  function listAllLessons(): Lesson[] {
    const rows = db.prepare('SELECT * FROM local_lessons ORDER BY created_at DESC').all() as LessonRow[]
    return rows.map(rowToLesson)
  }

  function listUnpublishedLessons(): Lesson[] {
    const rows = db.prepare(`
      SELECT ll.* FROM local_lessons ll
      LEFT JOIN published_log pl ON ll.id = pl.lesson_id AND pl.unpublished_at IS NULL
      WHERE ll.outdated = 0 AND pl.id IS NULL
      ORDER BY ll.created_at DESC
    `).all() as LessonRow[]
    return rows.map(rowToLesson)
  }

  function listTraceSessions(): Array<{ sessionId: string; stepCount: number; hasErrors: boolean }> {
    const rows = db.prepare(`
      SELECT session_id,
             COUNT(*) as step_count,
             SUM(CASE WHEN significance = 'error' THEN 1 ELSE 0 END) as error_count
      FROM trace_steps
      GROUP BY session_id
      ORDER BY MAX(timestamp) DESC
    `).all() as Array<{ session_id: string; step_count: number; error_count: number }>
    return rows.map(r => ({
      sessionId: r.session_id,
      stepCount: r.step_count,
      hasErrors: r.error_count > 0,
    }))
  }

  function getInjectionStats(sinceMsAgo?: number): { total: number; injected: number } {
    const cutoff = sinceMsAgo ? Date.now() - sinceMsAgo : 0
    const row = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN injected = 1 THEN 1 ELSE 0 END) as injected
      FROM injection_log
      WHERE created_at > ?
    `).get(cutoff) as { total: number; injected: number }
    return { total: row.total, injected: row.injected ?? 0 }
  }

  function updateLessonRelevanceScore(id: number, score: number): void {
    db.prepare('UPDATE local_lessons SET relevance_score = ?, updated_at = ? WHERE id = ?').run(score, Date.now(), id)
  }

  function listLessonsWithContradictions(minCount = 3): Array<{ lessonId: number; contradictionCount: number }> {
    const rows = db.prepare(`
      SELECT f.lesson_id, COUNT(*) as cnt
      FROM feedback f
      JOIN local_lessons ll ON f.lesson_id = ll.id
      WHERE f.type = 'contradicted' AND ll.outdated = 0
      GROUP BY f.lesson_id
      HAVING COUNT(*) >= ?
    `).all(minCount) as Array<{ lesson_id: number; cnt: number }>
    return rows.map(r => ({ lessonId: r.lesson_id, contradictionCount: r.cnt }))
  }

  function getTraceStepCount(): number {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM trace_steps').get() as { cnt: number }
    return row.cnt
  }

  function getTableCounts(): Record<string, number> {
    const tables = ['local_lessons', 'trace_steps', 'feedback', 'published_log', 'injection_log', 'context_cache']
    const counts: Record<string, number> = {}
    for (const t of tables) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get() as { cnt: number }
      counts[t] = row.cnt
    }
    return counts
  }

  function getFts5Status(): { available: boolean; rowCount: number } {
    if (!fts5Available) return { available: false, rowCount: 0 }
    try {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM local_lessons_fts').get() as { cnt: number }
      return { available: true, rowCount: row.cnt }
    } catch {
      return { available: true, rowCount: 0 }
    }
  }

  function getOutdatedLessonCount(): number {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM local_lessons WHERE outdated = 1').get() as { cnt: number }
    return row.cnt
  }

  function getLastPublish(): PublishedLog | null {
    const row = db.prepare(`
      SELECT * FROM published_log
      WHERE unpublished_at IS NULL
      ORDER BY published_at DESC
      LIMIT 1
    `).get() as {
      id: number
      lesson_id: number
      relay_event_id: string | null
      published_at: number
      unpublished_at: number | null
    } | undefined
    if (!row) return null
    return {
      id: row.id,
      lessonId: row.lesson_id,
      relayEventId: row.relay_event_id ?? undefined,
      publishedAt: row.published_at,
      unpublishedAt: row.unpublished_at ?? undefined,
    }
  }

  function getPublishedCount(): number {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM published_log WHERE unpublished_at IS NULL').get() as { cnt: number }
    return row.cnt
  }

  // ── Close ────────────────────────────────────────────────────────────────

  function close(): void {
    db.close()
  }

  return {
    // Meta
    fts5Available,
    close,

    // Lessons
    insertLesson,
    getLesson,
    markOutdated,
    deleteLesson,
    listLessons,
    listLessonsPaginated,
    incrementApplied,
    searchLessons,

    // Trace
    insertTraceStep,
    getTraceSteps,
    deleteTraceSteps,

    // Feedback
    insertFeedback,
    getFeedbackForLesson,

    // Published log
    insertPublishedLog,
    markUnpublished,
    getPublishedLog,

    // Injection log
    insertInjectionLog,

    // Service helpers
    getLessonCount,
    getNewLessonCount,
    listLessonsForDistillation,
    hasPublished,
    hasNewTraces,
    listAllLessons,
    listUnpublishedLessons,
    listTraceSessions,
    getInjectionStats,
    updateLessonRelevanceScore,
    listLessonsWithContradictions,
    getTraceStepCount,
    getTableCounts,
    getFts5Status,
    getOutdatedLessonCount,
    getLastPublish,
    getPublishedCount,

    // Context cache
    upsertContextCache,
    getContextCache,
    deleteContextCache,
  }
}
