import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runTraceEvaluator } from '../../src/service/trace-evaluator.js'
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

describe('runTraceEvaluator', () => {
  let db: Db
  let logger: PluginLogger

  beforeEach(() => {
    db = createDb()
    logger = mockLogger()
  })

  afterEach(() => {
    db.close()
  })

  it('identifies high-value traces (3+ steps with errors)', async () => {
    // Session with 3 steps and an error
    db.insertTraceStep({ sessionId: 'sess-1', action: 'read', significance: 'routine' })
    db.insertTraceStep({ sessionId: 'sess-1', action: 'exec', significance: 'significant' })
    db.insertTraceStep({ sessionId: 'sess-1', action: 'exec', significance: 'error', errorSignature: 'ENOENT' })

    const result = await runTraceEvaluator(db, config, logger)

    expect(result).toHaveLength(1)
    expect(result[0].highValue).toBe(true)
    expect(result[0].sessionId).toBe('sess-1')
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('high-value trace: sess-1'),
    )
  })

  it('does not mark short traces as high-value', async () => {
    // Only 2 steps
    db.insertTraceStep({ sessionId: 'sess-2', action: 'read', significance: 'error' })
    db.insertTraceStep({ sessionId: 'sess-2', action: 'exec', significance: 'error' })

    const result = await runTraceEvaluator(db, config, logger)

    expect(result).toHaveLength(1)
    expect(result[0].highValue).toBe(false)
  })

  it('does not mark error-free traces as high-value', async () => {
    // 5 steps but no errors
    for (let i = 0; i < 5; i++) {
      db.insertTraceStep({ sessionId: 'sess-3', action: `step-${i}`, significance: 'routine' })
    }

    const result = await runTraceEvaluator(db, config, logger)

    expect(result).toHaveLength(1)
    expect(result[0].highValue).toBe(false)
  })

  it('evaluates multiple sessions independently', async () => {
    // High-value session
    db.insertTraceStep({ sessionId: 'hv', action: 'a', significance: 'error' })
    db.insertTraceStep({ sessionId: 'hv', action: 'b', significance: 'routine' })
    db.insertTraceStep({ sessionId: 'hv', action: 'c', significance: 'routine' })

    // Low-value session
    db.insertTraceStep({ sessionId: 'lv', action: 'a', significance: 'routine' })

    const result = await runTraceEvaluator(db, config, logger)

    expect(result).toHaveLength(2)
    const hv = result.find(r => r.sessionId === 'hv')!
    const lv = result.find(r => r.sessionId === 'lv')!
    expect(hv.highValue).toBe(true)
    expect(lv.highValue).toBe(false)
  })

  it('handles empty traces', async () => {
    const result = await runTraceEvaluator(db, config, logger)

    expect(result).toHaveLength(0)
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('no traces to evaluate'),
    )
  })
})
