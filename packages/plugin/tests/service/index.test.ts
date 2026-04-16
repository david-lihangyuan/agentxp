import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createService,
  createModules,
  runModules,
  computeBackoff,
} from '../../src/service/index.js'
import type { ModuleState, ServiceModule, PluginLogger } from '../../src/service/types.js'
import { createDb } from '../../src/db.js'
import type { Db } from '../../src/db.js'
import { DEFAULT_CONFIG } from '../../src/types.js'

function mockLogger(): PluginLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}

describe('computeBackoff', () => {
  it('returns 5s for first failure', () => {
    expect(computeBackoff(1)).toBe(5000)
  })

  it('returns 25s for second failure', () => {
    expect(computeBackoff(2)).toBe(25000)
  })

  it('returns 125s for third failure', () => {
    expect(computeBackoff(3)).toBe(125000)
  })

  it('caps at 10 minutes', () => {
    expect(computeBackoff(4)).toBe(600000)
    expect(computeBackoff(10)).toBe(600000)
  })
})

describe('runModules', () => {
  let logger: PluginLogger
  let states: Map<string, ModuleState>

  beforeEach(() => {
    logger = mockLogger()
    states = new Map()
  })

  it('runs a module when interval elapsed and condition true', async () => {
    const runFn = vi.fn()
    const modules: ServiceModule[] = [{
      id: 'test',
      intervalMs: 1000,
      condition: () => true,
      run: runFn,
    }]

    await runModules(modules, states, logger, Date.now())
    expect(runFn).toHaveBeenCalledOnce()
  })

  it('skips module when interval not elapsed', async () => {
    const runFn = vi.fn()
    const now = Date.now()
    const modules: ServiceModule[] = [{
      id: 'test',
      intervalMs: 60000,
      condition: () => true,
      run: runFn,
    }]

    // First run — should execute
    await runModules(modules, states, logger, now)
    expect(runFn).toHaveBeenCalledOnce()

    // Second run 10s later — should skip (interval is 60s)
    await runModules(modules, states, logger, now + 10000)
    expect(runFn).toHaveBeenCalledOnce()
  })

  it('skips module when condition is false', async () => {
    const runFn = vi.fn()
    const modules: ServiceModule[] = [{
      id: 'test',
      intervalMs: 1000,
      condition: () => false,
      run: runFn,
    }]

    await runModules(modules, states, logger, Date.now())
    expect(runFn).not.toHaveBeenCalled()
  })

  it('isolates module failures — one failing does not block others', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('boom'))
    const successFn = vi.fn()
    const modules: ServiceModule[] = [
      { id: 'fail', intervalMs: 1000, condition: () => true, run: failFn },
      { id: 'success', intervalMs: 1000, condition: () => true, run: successFn },
    ]

    await runModules(modules, states, logger, Date.now())

    expect(failFn).toHaveBeenCalledOnce()
    expect(successFn).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[agentxp/fail] failed (1x)'))
  })

  it('applies exponential backoff after failure', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('boom'))
    const now = Date.now()
    const modules: ServiceModule[] = [{
      id: 'flaky',
      intervalMs: 1000,
      condition: () => true,
      run: failFn,
    }]

    // First run — fails, sets backoff to 5s
    await runModules(modules, states, logger, now)
    expect(failFn).toHaveBeenCalledOnce()

    const state = states.get('flaky')!
    expect(state.consecutiveFailures).toBe(1)
    expect(state.backoffMs).toBe(5000)

    // 2s later — within backoff, should skip
    await runModules(modules, states, logger, now + 2000)
    expect(failFn).toHaveBeenCalledOnce()

    // 6s later — past backoff, should run again
    await runModules(modules, states, logger, now + 6000)
    expect(failFn).toHaveBeenCalledTimes(2)

    // Second failure increases backoff
    const state2 = states.get('flaky')!
    expect(state2.consecutiveFailures).toBe(2)
    expect(state2.backoffMs).toBe(25000)
  })

  it('resets backoff on success', async () => {
    let callCount = 0
    const flakyFn = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) throw new Error('first fail')
      // success on subsequent calls
    })
    const now = Date.now()
    const modules: ServiceModule[] = [{
      id: 'flaky',
      intervalMs: 1000,
      condition: () => true,
      run: flakyFn,
    }]

    // First call: fails
    await runModules(modules, states, logger, now)
    expect(states.get('flaky')!.consecutiveFailures).toBe(1)

    // Second call after backoff: succeeds
    await runModules(modules, states, logger, now + 6000)
    expect(states.get('flaky')!.consecutiveFailures).toBe(0)
    expect(states.get('flaky')!.backoffMs).toBe(0)
  })

  it('updates lastRun on success', async () => {
    const runFn = vi.fn()
    const now = Date.now()
    const modules: ServiceModule[] = [{
      id: 'test',
      intervalMs: 1000,
      condition: () => true,
      run: runFn,
    }]

    await runModules(modules, states, logger, now)
    expect(states.get('test')!.lastRun).toBe(now)
  })
})

describe('createModules', () => {
  let db: Db
  let logger: PluginLogger

  beforeEach(() => {
    db = createDb()
    logger = mockLogger()
  })

  it('creates 8 modules', () => {
    const modules = createModules(db, DEFAULT_CONFIG, logger)
    expect(modules).toHaveLength(8)
  })

  it('module IDs are unique', () => {
    const modules = createModules(db, DEFAULT_CONFIG, logger)
    const ids = modules.map(m => m.id)
    expect(new Set(ids).size).toBe(8)
  })

  it('includes all expected module IDs', () => {
    const modules = createModules(db, DEFAULT_CONFIG, logger)
    const ids = modules.map(m => m.id)
    expect(ids).toContain('distiller')
    expect(ids).toContain('publisher')
    expect(ids).toContain('puller')
    expect(ids).toContain('feedback-loop')
    expect(ids).toContain('outdated-detector')
    expect(ids).toContain('trace-evaluator')
    expect(ids).toContain('key-manager')
    expect(ids).toContain('weekly-digest')
  })

  it('publisher condition requires autoPublish and network mode', () => {
    const localModules = createModules(db, { ...DEFAULT_CONFIG, mode: 'local' }, logger)
    const pubLocal = localModules.find(m => m.id === 'publisher')!
    expect(pubLocal.condition()).toBe(false)

    const networkModules = createModules(db, { ...DEFAULT_CONFIG, mode: 'network', autoPublish: true }, logger)
    const pubNetwork = networkModules.find(m => m.id === 'publisher')!
    expect(pubNetwork.condition()).toBe(true)
  })

  it('puller condition requires network mode', () => {
    const localModules = createModules(db, { ...DEFAULT_CONFIG, mode: 'local' }, logger)
    const pullLocal = localModules.find(m => m.id === 'puller')!
    expect(pullLocal.condition()).toBe(false)

    const networkModules = createModules(db, { ...DEFAULT_CONFIG, mode: 'network' }, logger)
    const pullNetwork = networkModules.find(m => m.id === 'puller')!
    expect(pullNetwork.condition()).toBe(true)
  })

  it('weekly-digest condition depends on weeklyDigest config', () => {
    const onModules = createModules(db, { ...DEFAULT_CONFIG, weeklyDigest: true }, logger)
    expect(onModules.find(m => m.id === 'weekly-digest')!.condition()).toBe(true)

    const offModules = createModules(db, { ...DEFAULT_CONFIG, weeklyDigest: false }, logger)
    expect(offModules.find(m => m.id === 'weekly-digest')!.condition()).toBe(false)
  })

  it('distiller condition requires 5+ new lessons', () => {
    const modules = createModules(db, DEFAULT_CONFIG, logger)
    const distiller = modules.find(m => m.id === 'distiller')!
    expect(distiller.condition()).toBe(false) // no lessons yet

    // Add 5 lessons
    for (let i = 0; i < 5; i++) {
      db.insertLesson({ what: `w${i}`, tried: 't', outcome: 'o', learned: 'l' })
    }
    expect(distiller.condition()).toBe(true)
  })
})

describe('createService', () => {
  let db: Db

  beforeEach(() => {
    db = createDb()
  })

  it('has id = agentxp', () => {
    const service = createService(db, DEFAULT_CONFIG)
    expect(service.id).toBe('agentxp')
  })

  it('start and stop work without errors', async () => {
    const logger = mockLogger()
    const service = createService(db, DEFAULT_CONFIG)

    await service.start({ logger })
    await service.stop({ logger })

    expect(logger.info).toHaveBeenCalledWith('[agentxp] service started')
    expect(logger.info).toHaveBeenCalledWith('[agentxp] service stopped')
  })

  it('stop clears interval', async () => {
    const logger = mockLogger()
    const service = createService(db, DEFAULT_CONFIG)

    await service.start({ logger })
    // Stop should be clean
    await service.stop({ logger })
    // Calling stop again should be safe
    await service.stop({ logger })
  })
})
