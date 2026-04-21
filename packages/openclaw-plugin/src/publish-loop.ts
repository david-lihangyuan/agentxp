// Background scheduler around publishStagedExperiences. The plugin
// captures traces into the local staging DB on the hot path; a
// separate periodic loop drains the DB to the relay so network
// latency never blocks a tool call.
//
// Reentrancy guard: if one cycle is still in flight when the timer
// fires we skip the new cycle (rather than stacking). Errors from the
// publisher are routed to onError and do NOT stop the loop.
import type { AgentKey } from '@agentxp/protocol'

import type { PluginDb } from './db.js'
import { publishStagedExperiences, type PublishResult } from './publisher.js'

export interface PublishLoopOptions {
  db: PluginDb
  agent: AgentKey
  relayUrl: string
  intervalMs: number
  fetch?: typeof globalThis.fetch
  now?: () => number
  onResult?: (results: PublishResult[]) => void
  onError?: (err: unknown) => void
}

export interface PublishLoopHandle {
  stop(): void
  runNow(): Promise<PublishResult[]>
}

export function startPublishLoop(opts: PublishLoopOptions): PublishLoopHandle {
  if (!Number.isFinite(opts.intervalMs) || opts.intervalMs <= 0) {
    throw new Error(
      `startPublishLoop: intervalMs must be a positive finite number (got ${opts.intervalMs})`,
    )
  }

  let stopped = false
  let inFlight = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) {
      schedule()
      return
    }
    inFlight = true
    try {
      const results = await publishStagedExperiences({
        db: opts.db,
        agent: opts.agent,
        relayUrl: opts.relayUrl,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      })
      if (opts.onResult) {
        try {
          opts.onResult(results)
        } catch {
          // Consumer hook must not crash the loop.
        }
      }
    } catch (err) {
      if (opts.onError) {
        try {
          opts.onError(err)
        } catch {
          // Consumer hook must not crash the loop.
        }
      }
    } finally {
      inFlight = false
      schedule()
    }
  }

  function schedule(): void {
    if (stopped) return
    timer = setTimeout(() => {
      void tick()
    }, opts.intervalMs)
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      // Don't keep the Node event loop alive on our account.
      ;(timer as { unref: () => void }).unref()
    }
  }

  schedule()

  return {
    stop(): void {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    async runNow(): Promise<PublishResult[]> {
      if (stopped) return []
      if (inFlight) return []
      inFlight = true
      try {
        const results = await publishStagedExperiences({
          db: opts.db,
          agent: opts.agent,
          relayUrl: opts.relayUrl,
          ...(opts.fetch ? { fetch: opts.fetch } : {}),
          ...(opts.now ? { now: opts.now } : {}),
        })
        if (opts.onResult) {
          try {
            opts.onResult(results)
          } catch {
            // ignore consumer errors
          }
        }
        return results
      } finally {
        inFlight = false
      }
    },
  }
}
