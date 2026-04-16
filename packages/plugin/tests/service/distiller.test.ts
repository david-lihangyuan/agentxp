import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runDistiller } from '../../src/service/distiller.js'
import { createDb } from '../../src/db.js'
import type { Db } from '../../src/db.js'
import type { PluginLogger } from '../../src/service/types.js'

function mockLogger(): PluginLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

describe('runDistiller', () => {
  let db: Db
  let logger: PluginLogger

  beforeEach(() => {
    db = createDb()
    logger = mockLogger()
  })

  afterEach(() => {
    db.close()
  })

  it('does nothing when no groups are large enough', async () => {
    // Add 3 lessons with same tag (below threshold of 5)
    for (let i = 0; i < 3; i++) {
      db.insertLesson({
        what: `what ${i}`, tried: 'tried', outcome: 'outcome',
        learned: 'learned', tags: ['testing'],
      })
    }

    await runDistiller(db, logger)
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('no groups ready'),
    )
  })

  it('merges 5+ lessons with same tag into a strategy rule', async () => {
    // Insert 5 lessons sharing a tag
    for (let i = 0; i < 5; i++) {
      db.insertLesson({
        what: `what ${i}`, tried: `tried ${i}`, outcome: `outcome ${i}`,
        learned: `lesson ${i}`, tags: ['error-handling'],
      })
    }

    await runDistiller(db, logger)

    // The 5 original lessons should be marked outdated
    const allLessons = db.listAllLessons()
    const outdated = allLessons.filter(l => l.outdated)
    expect(outdated).toHaveLength(5)

    // A new merged lesson should exist
    const active = allLessons.filter(l => !l.outdated)
    expect(active.length).toBeGreaterThanOrEqual(1)

    const merged = active.find(l => l.what.includes('[strategy]'))
    expect(merged).toBeDefined()
    expect(merged!.what).toContain('error-handling')
    expect(merged!.tags).toContain('error-handling')
    expect(merged!.learned).toContain('lesson 0')
  })

  it('deduplicates learned text in merged lesson', async () => {
    for (let i = 0; i < 5; i++) {
      db.insertLesson({
        what: `what ${i}`, tried: `tried ${i}`, outcome: `outcome ${i}`,
        learned: 'same lesson text', tags: ['dedup'],
      })
    }

    await runDistiller(db, logger)

    const allLessons = db.listAllLessons()
    const merged = allLessons.find(l => l.what.includes('[strategy]'))
    expect(merged).toBeDefined()
    // Should only appear once (deduplicated)
    expect(merged!.learned).toBe('same lesson text')
  })

  it('collects all unique tags from originals', async () => {
    for (let i = 0; i < 5; i++) {
      db.insertLesson({
        what: `what ${i}`, tried: 'tried', outcome: 'outcome',
        learned: `l${i}`, tags: ['shared-tag', `unique-${i}`],
      })
    }

    await runDistiller(db, logger)

    const allLessons = db.listAllLessons()
    const merged = allLessons.find(l => l.what.includes('[strategy]'))
    expect(merged).toBeDefined()
    expect(merged!.tags).toContain('shared-tag')
    expect(merged!.tags).toContain('unique-0')
    expect(merged!.tags).toContain('unique-4')
  })

  it('logs merge information', async () => {
    for (let i = 0; i < 5; i++) {
      db.insertLesson({
        what: `what ${i}`, tried: 'tried', outcome: 'outcome',
        learned: `l${i}`, tags: ['logging-test'],
      })
    }

    await runDistiller(db, logger)

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('merged 5 lessons'),
    )
  })
})
