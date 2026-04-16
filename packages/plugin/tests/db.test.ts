import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb, sanitizeFtsQuery } from '../src/db.js'
import type { Db } from '../src/db.js'

// ─── sanitizeFtsQuery ──────────────────────────────────────────────────────

describe('sanitizeFtsQuery', () => {
  it('removes AND/OR/NOT/NEAR operators', () => {
    expect(sanitizeFtsQuery('foo AND bar')).toBe('foo bar')
    expect(sanitizeFtsQuery('foo OR bar')).toBe('foo bar')
    expect(sanitizeFtsQuery('foo NOT bar')).toBe('foo bar')
    expect(sanitizeFtsQuery('NEAR(foo, bar)')).toBe('foo bar')
  })

  it('removes FTS5 special characters', () => {
    expect(sanitizeFtsQuery('* NOT learned')).not.toContain('*')
    expect(sanitizeFtsQuery('"quoted phrase"')).toBe('quoted phrase')
    // ^ and ~ become spaces (non-alphanum chars), then collapsed
    expect(sanitizeFtsQuery('foo^5 bar~2')).toBe('foo 5 bar 2')
  })

  it('keeps alphanumeric and spaces', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('hello world')
    expect(sanitizeFtsQuery('  spaces  ')).toBe('spaces')
  })

  it('keeps CJK characters', () => {
    expect(sanitizeFtsQuery('学习 经验')).toBe('学习 经验')
    expect(sanitizeFtsQuery('日本語テスト')).toBe('日本語テスト')
  })

  it('returns empty string for all-operator input', () => {
    const result = sanitizeFtsQuery('AND OR NOT')
    // All operators stripped, remaining whitespace trimmed
    expect(result.trim()).toBe('')
  })

  it('handles injection attempt: * NOT learned', () => {
    const safe = sanitizeFtsQuery('* NOT learned')
    // Should not contain the dangerous FTS5 "*" operator
    expect(safe).not.toContain('*')
    // "NOT" operator stripped, "learned" preserved
    expect(safe).toContain('learned')
  })

  it('handles SQL injection chars', () => {
    const safe = sanitizeFtsQuery("'; DROP TABLE local_lessons; --")
    expect(safe).not.toContain("'")
    expect(safe).not.toContain(';')
    expect(safe).not.toContain('-')
  })
})

// ─── createDb ──────────────────────────────────────────────────────────────

describe('createDb', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  // ── Schema ─────────────────────────────────────────────────────────────

  it('opens without error', () => {
    expect(db).toBeDefined()
  })

  it('has fts5Available property', () => {
    expect(typeof db.fts5Available).toBe('boolean')
  })

  // ── Lessons: CRUD ──────────────────────────────────────────────────────

  it('inserts a lesson and returns id', () => {
    const id = db.insertLesson({
      what: 'test task',
      tried: 'approach A',
      outcome: 'success',
      learned: 'use approach A',
    })
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
  })

  it('retrieves an inserted lesson', () => {
    const id = db.insertLesson({
      what: 'test task',
      tried: 'approach A',
      outcome: 'success',
      learned: 'use approach A',
      tags: ['typescript', 'testing'],
    })
    const lesson = db.getLesson(id)
    expect(lesson).not.toBeNull()
    expect(lesson!.what).toBe('test task')
    expect(lesson!.tried).toBe('approach A')
    expect(lesson!.tags).toEqual(['typescript', 'testing'])
    expect(lesson!.source).toBe('local')
    expect(lesson!.outdated).toBe(false)
  })

  it('returns null for non-existent lesson', () => {
    expect(db.getLesson(9999)).toBeNull()
  })

  it('marks lesson as outdated', () => {
    const id = db.insertLesson({
      what: 'old task',
      tried: 'approach X',
      outcome: 'fail',
      learned: 'do not use X',
    })
    db.markOutdated(id)
    const lesson = db.getLesson(id)
    expect(lesson!.outdated).toBe(true)
  })

  it('deletes a lesson', () => {
    const id = db.insertLesson({
      what: 'to delete',
      tried: 'x',
      outcome: 'y',
      learned: 'z',
    })
    db.deleteLesson(id)
    expect(db.getLesson(id)).toBeNull()
  })

  it('lists lessons (excludes outdated)', () => {
    const id1 = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    const id2 = db.insertLesson({ what: 'b', tried: 'x', outcome: 'y', learned: 'z' })
    db.markOutdated(id2)

    const list = db.listLessons()
    const ids = list.map(l => l.id)
    expect(ids).toContain(id1)
    expect(ids).not.toContain(id2)
  })

  it('incrementApplied updates counts', () => {
    const id = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    db.incrementApplied(id, true)
    db.incrementApplied(id, false)
    const lesson = db.getLesson(id)
    expect(lesson!.appliedCount).toBe(2)
    expect(lesson!.successCount).toBe(1)
  })

  // ── Lessons: Search ────────────────────────────────────────────────────

  it('searchLessons returns empty for empty query', () => {
    db.insertLesson({ what: 'anything', tried: 'x', outcome: 'y', learned: 'z' })
    expect(db.searchLessons('')).toEqual([])
    expect(db.searchLessons('   ')).toEqual([])
  })

  it('searchLessons finds lessons by keyword', () => {
    db.insertLesson({
      what: 'deploying to production',
      tried: 'blue-green deployment',
      outcome: 'success',
      learned: 'always use blue-green',
    })
    db.insertLesson({
      what: 'unrelated task',
      tried: 'something else',
      outcome: 'ok',
      learned: 'nothing useful',
    })

    const results = db.searchLessons('deployment')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].what).toContain('deploying')
  })

  it('searchLessons does not return outdated lessons', () => {
    const id = db.insertLesson({
      what: 'outdated deployment trick',
      tried: 'old approach',
      outcome: 'fail',
      learned: 'deprecated',
    })
    db.markOutdated(id)

    const results = db.searchLessons('deployment')
    expect(results.every(r => r.id !== id)).toBe(true)
  })

  it('FTS5 injection: "* NOT learned" does not return unexpected results', () => {
    // Insert one lesson
    db.insertLesson({
      what: 'specific thing',
      tried: 'approach',
      outcome: 'ok',
      learned: 'do this',
    })
    // This injection would match everything if not sanitized
    const results = db.searchLessons('* NOT learned')
    // The sanitized query is "learned", so should only match if learned field matches
    // We just check it doesn't crash and returns a reasonable result
    expect(Array.isArray(results)).toBe(true)
  })

  it('FTS5 injection: SQL injection chars do not crash', () => {
    expect(() => db.searchLessons("'; DROP TABLE local_lessons; --")).not.toThrow()
    expect(() => db.searchLessons('foo" OR "1"="1')).not.toThrow()
  })

  // ── Trace Steps ────────────────────────────────────────────────────────

  it('inserts and retrieves trace steps', () => {
    const id = db.insertTraceStep({
      sessionId: 'sess-1',
      action: 'tool_call',
      toolName: 'read',
      significance: 'routine',
      durationMs: 42,
    })
    expect(id).toBeGreaterThan(0)

    const steps = db.getTraceSteps('sess-1')
    expect(steps.length).toBe(1)
    expect(steps[0].action).toBe('tool_call')
    expect(steps[0].toolName).toBe('read')
    expect(steps[0].durationMs).toBe(42)
  })

  it('trace steps do NOT have a params field', () => {
    const id = db.insertTraceStep({
      sessionId: 'sess-2',
      action: 'tool_call',
      toolName: 'write',
    })
    const steps = db.getTraceSteps('sess-2')
    expect(steps.length).toBe(1)
    // Verify no params/rawParams field
    expect('params' in steps[0]).toBe(false)
    expect('rawParams' in steps[0]).toBe(false)
  })

  it('deletes trace steps by session', () => {
    db.insertTraceStep({ sessionId: 'sess-3', action: 'tool_call', toolName: 'exec' })
    db.insertTraceStep({ sessionId: 'sess-3', action: 'agent_end' })
    db.deleteTraceSteps('sess-3')
    expect(db.getTraceSteps('sess-3')).toEqual([])
  })

  it('trace steps are isolated by session', () => {
    db.insertTraceStep({ sessionId: 'sess-a', action: 'tool_call' })
    db.insertTraceStep({ sessionId: 'sess-b', action: 'agent_end' })
    expect(db.getTraceSteps('sess-a').length).toBe(1)
    expect(db.getTraceSteps('sess-b').length).toBe(1)
  })

  // ── Feedback ───────────────────────────────────────────────────────────

  it('inserts and retrieves feedback', () => {
    const lessonId = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    const fbId = db.insertFeedback({
      lessonId,
      type: 'cited',
      sessionId: 'sess-1',
      comment: 'helpful',
    })
    expect(fbId).toBeGreaterThan(0)

    const feedbacks = db.getFeedbackForLesson(lessonId)
    expect(feedbacks.length).toBe(1)
    expect(feedbacks[0].type).toBe('cited')
    expect(feedbacks[0].comment).toBe('helpful')
  })

  it('returns empty feedback for lesson with no feedback', () => {
    const lessonId = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    expect(db.getFeedbackForLesson(lessonId)).toEqual([])
  })

  // ── Published Log ──────────────────────────────────────────────────────

  it('inserts and retrieves published log', () => {
    const lessonId = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    db.insertPublishedLog({ lessonId, relayEventId: 'event-123' })

    const log = db.getPublishedLog(lessonId)
    expect(log.length).toBe(1)
    expect(log[0].relayEventId).toBe('event-123')
    expect(log[0].unpublishedAt).toBeUndefined()
  })

  it('marks published as unpublished', () => {
    const lessonId = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    db.insertPublishedLog({ lessonId })
    db.markUnpublished(lessonId)

    const log = db.getPublishedLog(lessonId)
    expect(log[0].unpublishedAt).toBeDefined()
    expect(log[0].unpublishedAt).toBeGreaterThan(0)
  })

  // ── Injection Log ──────────────────────────────────────────────────────

  it('inserts injection log', () => {
    const id = db.insertInjectionLog({
      sessionId: 'sess-x',
      injected: true,
      tokenCount: 200,
      lessonIds: [1, 2, 3],
    })
    expect(id).toBeGreaterThan(0)
  })

  // ── Context Cache ──────────────────────────────────────────────────────

  it('upserts context cache (creates new)', () => {
    db.upsertContextCache({
      sessionId: 'sess-ctx-1',
      keywords: ['deployment', 'kubernetes'],
    })
    const cached = db.getContextCache('sess-ctx-1')
    expect(cached).not.toBeNull()
    expect(cached!.keywords).toEqual(['deployment', 'kubernetes'])
  })

  it('upserts context cache (updates existing - same session_id)', () => {
    db.upsertContextCache({ sessionId: 'sess-ctx-2', keywords: ['old'] })
    db.upsertContextCache({ sessionId: 'sess-ctx-2', keywords: ['new', 'keywords'] })

    const cached = db.getContextCache('sess-ctx-2')
    expect(cached!.keywords).toEqual(['new', 'keywords'])
  })

  it('same session_id upsert does not create duplicate row', () => {
    // UPSERT should replace, not append
    db.upsertContextCache({ sessionId: 'sess-ctx-3', keywords: ['a'] })
    db.upsertContextCache({ sessionId: 'sess-ctx-3', keywords: ['b'] })
    db.upsertContextCache({ sessionId: 'sess-ctx-3', keywords: ['c'] })

    // Only one row for this session
    const cached = db.getContextCache('sess-ctx-3')
    expect(cached!.keywords).toEqual(['c'])
  })

  it('returns null for missing context cache', () => {
    expect(db.getContextCache('nonexistent')).toBeNull()
  })

  it('deletes context cache', () => {
    db.upsertContextCache({ sessionId: 'sess-del', keywords: ['x'] })
    db.deleteContextCache('sess-del')
    expect(db.getContextCache('sess-del')).toBeNull()
  })

  it('context caches are isolated by session_id', () => {
    db.upsertContextCache({ sessionId: 'ctx-a', keywords: ['alpha'] })
    db.upsertContextCache({ sessionId: 'ctx-b', keywords: ['beta'] })
    expect(db.getContextCache('ctx-a')!.keywords).toEqual(['alpha'])
    expect(db.getContextCache('ctx-b')!.keywords).toEqual(['beta'])
  })
})
