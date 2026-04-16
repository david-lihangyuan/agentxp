import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runOutdatedDetector } from '../../src/service/outdated-detector.js'
import { createDb } from '../../src/db.js'
import type { Db } from '../../src/db.js'
import type { PluginLogger } from '../../src/service/types.js'

function mockLogger(): PluginLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

describe('runOutdatedDetector', () => {
  let db: Db
  let logger: PluginLogger

  beforeEach(() => {
    db = createDb()
    logger = mockLogger()
  })

  afterEach(() => {
    db.close()
  })

  it('does nothing when no lessons have 3+ contradictions', async () => {
    const lessonId = db.insertLesson({
      what: 'test', tried: 'tried', outcome: 'outcome', learned: 'learned',
    })

    // Add 2 contradictions (below threshold)
    db.insertFeedback({ lessonId, type: 'contradicted' })
    db.insertFeedback({ lessonId, type: 'contradicted' })

    await runOutdatedDetector(db, logger)

    const lesson = db.getLesson(lessonId)!
    expect(lesson.outdated).toBe(false)
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('no lessons with 3+ contradictions'),
    )
  })

  it('marks lesson outdated with 3+ contradictions', async () => {
    const lessonId = db.insertLesson({
      what: 'outdated lesson', tried: 'tried', outcome: 'outcome', learned: 'learned',
    })

    db.insertFeedback({ lessonId, type: 'contradicted' })
    db.insertFeedback({ lessonId, type: 'contradicted' })
    db.insertFeedback({ lessonId, type: 'contradicted' })

    await runOutdatedDetector(db, logger)

    const lesson = db.getLesson(lessonId)!
    expect(lesson.outdated).toBe(true)
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`marked lesson ${lessonId} outdated`),
    )
  })

  it('handles multiple lessons with contradictions', async () => {
    const id1 = db.insertLesson({ what: 'l1', tried: 't', outcome: 'o', learned: 'l' })
    const id2 = db.insertLesson({ what: 'l2', tried: 't', outcome: 'o', learned: 'l' })
    const id3 = db.insertLesson({ what: 'l3', tried: 't', outcome: 'o', learned: 'l' })

    // id1: 3 contradictions
    for (let i = 0; i < 3; i++) db.insertFeedback({ lessonId: id1, type: 'contradicted' })
    // id2: 5 contradictions
    for (let i = 0; i < 5; i++) db.insertFeedback({ lessonId: id2, type: 'contradicted' })
    // id3: 2 contradictions (below threshold)
    for (let i = 0; i < 2; i++) db.insertFeedback({ lessonId: id3, type: 'contradicted' })

    await runOutdatedDetector(db, logger)

    expect(db.getLesson(id1)!.outdated).toBe(true)
    expect(db.getLesson(id2)!.outdated).toBe(true)
    expect(db.getLesson(id3)!.outdated).toBe(false)
  })

  it('ignores non-contradicted feedback types', async () => {
    const lessonId = db.insertLesson({
      what: 'test', tried: 'tried', outcome: 'outcome', learned: 'learned',
    })

    db.insertFeedback({ lessonId, type: 'verified' })
    db.insertFeedback({ lessonId, type: 'cited' })
    db.insertFeedback({ lessonId, type: 'contradicted' })

    await runOutdatedDetector(db, logger)

    expect(db.getLesson(lessonId)!.outdated).toBe(false)
  })
})
