import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runFeedbackLoop } from '../../src/service/feedback-loop.js'
import { createDb } from '../../src/db.js'
import type { Db } from '../../src/db.js'
import type { PluginConfig } from '../../src/types.js'
import type { PluginLogger } from '../../src/service/types.js'

function mockLogger(): PluginLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

const config: PluginConfig = {
  mode: 'network',
  relayUrl: 'https://relay.test',
  maxInjectionTokens: 500,
  autoPublish: true,
  weaning: { enabled: true, rate: 0.1 },
  weeklyDigest: true,
}

describe('runFeedbackLoop', () => {
  let db: Db
  let logger: PluginLogger

  beforeEach(() => {
    db = createDb()
    logger = mockLogger()
  })

  afterEach(() => {
    db.close()
  })

  it('processes verified feedback and increases score', async () => {
    const lessonId = db.insertLesson({
      what: 'test', tried: 'tried', outcome: 'outcome', learned: 'learned',
    })

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        feedback: [{ lessonId, type: 'verified', comment: 'works great' }],
      }),
    })

    await runFeedbackLoop(db, config, logger, fetchFn as any)

    const lesson = db.getLesson(lessonId)!
    expect(lesson.relevanceScore).toBe(0.1) // 0 + 0.1
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('processed 1 feedback'),
    )
  })

  it('processes contradicted feedback and decreases score', async () => {
    const lessonId = db.insertLesson({
      what: 'test', tried: 'tried', outcome: 'outcome', learned: 'learned',
    })

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        feedback: [{ lessonId, type: 'contradicted' }],
      }),
    })

    await runFeedbackLoop(db, config, logger, fetchFn as any)

    const lesson = db.getLesson(lessonId)!
    // Score should not go below 0
    expect(lesson.relevanceScore).toBe(0)
  })

  it('processes cited feedback', async () => {
    const lessonId = db.insertLesson({
      what: 'test', tried: 'tried', outcome: 'outcome', learned: 'learned',
    })
    // Set initial score
    db.updateLessonRelevanceScore(lessonId, 0.5)

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        feedback: [{ lessonId, type: 'cited' }],
      }),
    })

    await runFeedbackLoop(db, config, logger, fetchFn as any)

    const lesson = db.getLesson(lessonId)!
    expect(lesson.relevanceScore).toBeCloseTo(0.55, 2)
  })

  it('handles non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    await runFeedbackLoop(db, config, logger, fetchFn as any)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('GET failed'),
    )
  })

  it('throws on fetch exception', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('timeout'))

    await expect(
      runFeedbackLoop(db, config, logger, fetchFn as any),
    ).rejects.toThrow('timeout')
  })

  it('handles empty feedback array', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ feedback: [] }),
    })

    await runFeedbackLoop(db, config, logger, fetchFn as any)
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('no new feedback'),
    )
  })

  it('score is capped at 1.0', async () => {
    const lessonId = db.insertLesson({
      what: 'test', tried: 'tried', outcome: 'outcome', learned: 'learned',
    })
    db.updateLessonRelevanceScore(lessonId, 0.95)

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        feedback: [{ lessonId, type: 'verified' }],
      }),
    })

    await runFeedbackLoop(db, config, logger, fetchFn as any)

    const lesson = db.getLesson(lessonId)!
    expect(lesson.relevanceScore).toBeLessThanOrEqual(1.0)
  })
})
