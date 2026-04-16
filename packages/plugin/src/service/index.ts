/**
 * service/index.ts — Main AgentXP background service.
 *
 * ONE registerService call with id='agentxp'.
 * start() → setInterval(5 min) → runModules() dispatches each sub-module.
 * Each module has independent error isolation with exponential backoff.
 * stop() → clearInterval + stopping flag.
 */

import type { Db } from '../db.js'
import type { PluginConfig } from '../types.js'
import type { PluginLogger, ServiceModule, ModuleState } from './types.js'
import { runDistiller } from './distiller.js'
import { runPublisher, type FetchFn as PublisherFetchFn } from './publisher.js'
import { runPuller, type FetchFn as PullerFetchFn } from './puller.js'
import { runFeedbackLoop, type FetchFn as FeedbackFetchFn } from './feedback-loop.js'
import { runOutdatedDetector } from './outdated-detector.js'
import { runTraceEvaluator } from './trace-evaluator.js'
import { runKeyManager, type FetchFn as KeyFetchFn } from './key-manager.js'
import { runWeeklyDigest } from './weekly-digest.js'

export interface ServiceContext {
  logger: PluginLogger
  signal?: AbortSignal
}

export interface AgentXPService {
  id: string
  start(ctx: ServiceContext): Promise<void>
  stop(ctx: ServiceContext): Promise<void>
}

export interface ServiceOptions {
  fetchFn?: typeof globalThis.fetch
}

/**
 * Exponential backoff: 5s → 25s → 125s → 600s (cap 10 min).
 */
export function computeBackoff(consecutiveFailures: number): number {
  return Math.min(10 * 60 * 1000, 5000 * Math.pow(5, consecutiveFailures - 1))
}

export function createModules(
  db: Db,
  config: PluginConfig,
  logger: PluginLogger,
  opts?: ServiceOptions,
): ServiceModule[] {
  const fetchFn = opts?.fetchFn ?? globalThis.fetch

  return [
    {
      id: 'distiller',
      intervalMs: 30 * 60 * 1000,
      condition: () => db.getNewLessonCount() >= 5,
      run: () => runDistiller(db, logger),
    },
    {
      id: 'publisher',
      intervalMs: 30 * 60 * 1000,
      condition: () => config.autoPublish && config.mode === 'network',
      run: () => runPublisher(db, config, logger, fetchFn as PublisherFetchFn),
    },
    {
      id: 'puller',
      intervalMs: 30 * 60 * 1000,
      condition: () => config.mode === 'network',
      run: () => runPuller(db, config, logger, fetchFn as PullerFetchFn),
    },
    {
      id: 'feedback-loop',
      intervalMs: 60 * 60 * 1000,
      condition: () => config.mode === 'network' && db.hasPublished(),
      run: () => runFeedbackLoop(db, config, logger, fetchFn as FeedbackFetchFn),
    },
    {
      id: 'outdated-detector',
      intervalMs: 24 * 60 * 60 * 1000,
      condition: () => true,
      run: () => runOutdatedDetector(db, logger),
    },
    {
      id: 'trace-evaluator',
      intervalMs: 60 * 60 * 1000,
      condition: () => db.hasNewTraces(),
      run: async () => { await runTraceEvaluator(db, config, logger) },
    },
    {
      id: 'key-manager',
      intervalMs: 24 * 60 * 60 * 1000,
      condition: () => config.mode === 'network',
      run: async () => { await runKeyManager(db, config, logger, fetchFn as KeyFetchFn) },
    },
    {
      id: 'weekly-digest',
      intervalMs: 7 * 24 * 60 * 60 * 1000,
      condition: () => config.weeklyDigest,
      run: async () => { await runWeeklyDigest(db, config, logger) },
    },
  ]
}

export async function runModules(
  modules: ServiceModule[],
  states: Map<string, ModuleState>,
  logger: PluginLogger,
  _now?: number,
): Promise<void> {
  const now = _now ?? Date.now()

  for (const mod of modules) {
    const state = states.get(mod.id) ?? { lastRun: 0, consecutiveFailures: 0, backoffMs: 0 }

    // Skip: interval not reached
    if (now - state.lastRun < mod.intervalMs) continue

    // Skip: condition not met
    if (!mod.condition()) continue

    // Skip: in backoff period
    if (state.backoffMs > 0 && now - state.lastRun < state.backoffMs) continue

    try {
      await mod.run()
      state.lastRun = now
      state.consecutiveFailures = 0
      state.backoffMs = 0
    } catch (err) {
      state.lastRun = now
      state.consecutiveFailures++
      state.backoffMs = computeBackoff(state.consecutiveFailures)
      logger.warn(`[agentxp/${mod.id}] failed (${state.consecutiveFailures}x): ${err}`)
    }

    states.set(mod.id, state)
  }
}

const TICK_INTERVAL_MS = 5 * 60 * 1000

export function createService(
  db: Db,
  config: PluginConfig,
  opts?: ServiceOptions,
): AgentXPService {
  let mainInterval: ReturnType<typeof setInterval> | null = null
  let stopping = false
  const states = new Map<string, ModuleState>()

  return {
    id: 'agentxp',

    async start(ctx: ServiceContext) {
      const { logger } = ctx
      stopping = false

      const modules = createModules(db, config, logger, opts)

      // Main loop: tick every 5 minutes
      mainInterval = setInterval(async () => {
        if (stopping) return
        await runModules(modules, states, logger)
      }, TICK_INTERVAL_MS)

      // Run immediately on start
      await runModules(modules, states, logger)

      logger.info('[agentxp] service started')
    },

    async stop(ctx: ServiceContext) {
      stopping = true
      if (mainInterval) {
        clearInterval(mainInterval)
        mainInterval = null
      }
      // Brief wait for in-flight operations
      await new Promise(r => setTimeout(r, 100))
      ctx.logger.info('[agentxp] service stopped')
    },
  }
}

export { runDistiller } from './distiller.js'
export { runPublisher } from './publisher.js'
export { runPuller } from './puller.js'
export { runFeedbackLoop } from './feedback-loop.js'
export { runOutdatedDetector } from './outdated-detector.js'
export { runTraceEvaluator } from './trace-evaluator.js'
export { runKeyManager } from './key-manager.js'
export { runWeeklyDigest, gatherStats, formatDigest } from './weekly-digest.js'
export type { PluginLogger, ServiceModule, ModuleState } from './types.js'
