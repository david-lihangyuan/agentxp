import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runWeeklyDigest, gatherStats, formatDigest } from '../../src/service/weekly-digest.js'
import { createDb } from '../../src/db.js'
import type { Db } from '../../src/db.js'
import type { PluginConfig } from '../../src/types.js'
import type { PluginLogger } from '../../src/service/types.js'

function mockLogger(): PluginLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

const config: PluginConfig = {
  mode: 'local',
  relayUrl: 'https://relay.test',
  maxInjectionTokens: 500,
  autoPublish: false,
  weaning: { enabled: true, rate: 0.1 },
  weeklyDigest: true,
}

describe('gatherStats', () => {
  let db: Db

  beforeEach(() => {
    db = createDb()
  })

  afterEach(() => {
    db.close()
  })

  it('returns zero stats for empty DB', () => {
    const stats = gatherStats(db)
    expect(stats.totalLessons).toBe(0)
    expect(stats.newLessons).toBe(0)
    expect(stats.totalInjections).toBe(0)
    expect(stats.successfulInjections).toBe(0)
    expect(stats.totalTraceSteps).toBe(0)
    expect(stats.traceSessions).toBe(0)
    expect(stats.highValueTraces).toBe(0)
  })

  it('counts lessons correctly', () => {
    db.insertLesson({ what: 'w1', tried: 't', outcome: 'o', learned: 'l' })
    db.insertLesson({ what: 'w2', tried: 't', outcome: 'o', learned: 'l' })

    const stats = gatherStats(db)
    expect(stats.totalLessons).toBe(2)
    expect(stats.newLessons).toBe(2) // created just now, within week
  })

  it('counts injections correctly', () => {
    db.insertInjectionLog({ sessionId: 's1', injected: true, tokenCount: 100, lessonIds: [1] })
    db.insertInjectionLog({ sessionId: 's2', injected: false })

    const stats = gatherStats(db)
    expect(stats.totalInjections).toBe(2)
    expect(stats.successfulInjections).toBe(1)
  })

  it('counts trace steps and sessions', () => {
    db.insertTraceStep({ sessionId: 'sess-a', action: 'read', significance: 'routine' })
    db.insertTraceStep({ sessionId: 'sess-a', action: 'exec', significance: 'error' })
    db.insertTraceStep({ sessionId: 'sess-b', action: 'exec', significance: 'routine' })

    const stats = gatherStats(db)
    expect(stats.totalTraceSteps).toBe(3)
    expect(stats.traceSessions).toBe(2)
  })

  it('counts high-value traces (3+ steps with errors)', () => {
    // High-value: 3 steps with error
    db.insertTraceStep({ sessionId: 'hv', action: 'a', significance: 'error' })
    db.insertTraceStep({ sessionId: 'hv', action: 'b', significance: 'routine' })
    db.insertTraceStep({ sessionId: 'hv', action: 'c', significance: 'routine' })

    // Not high-value: 2 steps
    db.insertTraceStep({ sessionId: 'lv', action: 'a', significance: 'error' })
    db.insertTraceStep({ sessionId: 'lv', action: 'b', significance: 'error' })

    const stats = gatherStats(db)
    expect(stats.highValueTraces).toBe(1)
  })
})

describe('formatDigest', () => {
  it('formats stats into readable markdown', () => {
    const digest = formatDigest({
      totalLessons: 42,
      newLessons: 5,
      totalInjections: 100,
      successfulInjections: 80,
      totalTraceSteps: 200,
      traceSessions: 15,
      highValueTraces: 3,
    })

    expect(digest).toContain('# AgentXP Weekly Digest')
    expect(digest).toContain('Total active: 42')
    expect(digest).toContain('New this week: 5')
    expect(digest).toContain('Total: 100')
    expect(digest).toContain('Successful: 80')
    expect(digest).toContain('Total steps: 200')
    expect(digest).toContain('Sessions: 15')
    expect(digest).toContain('High-value: 3')
  })

  it('includes date range', () => {
    const digest = formatDigest({
      totalLessons: 0, newLessons: 0, totalInjections: 0,
      successfulInjections: 0, totalTraceSteps: 0, traceSessions: 0,
      highValueTraces: 0,
    })

    // Should contain ISO date format
    expect(digest).toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})

describe('runWeeklyDigest', () => {
  let db: Db
  let logger: PluginLogger

  beforeEach(() => {
    db = createDb()
    logger = mockLogger()
  })

  afterEach(() => {
    db.close()
  })

  it('returns formatted digest string', async () => {
    db.insertLesson({ what: 'w', tried: 't', outcome: 'o', learned: 'l' })

    const digest = await runWeeklyDigest(db, config, logger)

    expect(digest).toContain('# AgentXP Weekly Digest')
    expect(digest).toContain('Total active: 1')
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('generated digest'),
    )
  })
})
