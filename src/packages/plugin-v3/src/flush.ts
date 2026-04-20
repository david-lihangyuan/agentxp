// M7 Batch 2.6 — auto-flush fallback.
// OpenClaw does not reliably dispatch session_end to plugins when a
// session terminates (verified empirically in 2026.4.15: sessions
// cleanup --enforce pruned ~30 stale sessions without firing a single
// session_end hook to this plugin). To avoid a plugin whose staging
// pipeline depends on an event the host may never send, the flush
// controller triggers onSessionEnd-equivalent staging on two
// host-independent conditions:
//   1. count threshold — after N tool calls accrue for a session
//   2. idle threshold — after T ms with no new tool calls for a
//      session
// Either condition triggers a single onSessionEnd call with a
// dedicated reason ('auto_count' | 'auto_idle'); onSessionEnd itself
// is idempotent because it clears trace_steps after staging, so a
// real session_end arriving later sees zero steps and returns
// no_activity without double-staging.
import type { PluginDb } from './db.js'
import { onSessionEnd } from './hooks.js'
import type { SessionSummaryInput } from './hooks.js'
import type { SessionEndReason } from './types.js'

export interface FlushControllerOptions {
  db: PluginDb
  // Steps per session before auto-stage. 0 disables the count trigger.
  countThreshold: number
  // Idle milliseconds before auto-stage. 0 disables the idle trigger.
  idleMs: number
  // Summary written into staged_experiences.data_json on auto-flush.
  summary: SessionSummaryInput
  // Injection seams for tests. In production the plugin uses Date.now
  // and node's native setTimeout/clearTimeout.
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface FlushController {
  // Call after each successful onToolCall (after_tool_call hook).
  onStep(sessionId: string): void
  // Call when a session ends by any means other than auto-flush
  // (session_end, agent_end). Drops any pending idle timer for the
  // session so it cannot fire phantom flushes after the session is
  // already gone.
  onEnd(sessionId: string): void
  // Release every pending timer. Intended for host shutdown / tests.
  shutdown(): void
}

interface SessionState {
  count: number
  timer: unknown | null
}

export function createFlushController(
  opts: FlushControllerOptions,
): FlushController {
  const now = opts.now ?? (() => Date.now())
  const setTimer =
    opts.setTimer ??
    ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer =
    opts.clearTimer ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  const sessions = new Map<string, SessionState>()

  function clearIdleTimer(state: SessionState) {
    if (state.timer !== null) {
      clearTimer(state.timer)
      state.timer = null
    }
  }

  function flush(sessionId: string, reason: SessionEndReason) {
    const state = sessions.get(sessionId)
    if (state !== undefined) clearIdleTimer(state)
    sessions.delete(sessionId)
    onSessionEnd(
      opts.db,
      {
        session_id: sessionId,
        ended_at: new Date(now()).toISOString(),
        reason,
      },
      opts.summary,
    )
  }

  function getOrCreate(sessionId: string): SessionState {
    let s = sessions.get(sessionId)
    if (s === undefined) {
      s = { count: 0, timer: null }
      sessions.set(sessionId, s)
    }
    return s
  }

  return {
    onStep(sessionId) {
      const state = getOrCreate(sessionId)
      state.count += 1
      clearIdleTimer(state)

      if (opts.countThreshold > 0 && state.count >= opts.countThreshold) {
        // Count trigger wins over idle — flush now and do not arm a
        // fresh idle timer since the session was just flushed.
        flush(sessionId, 'auto_count')
        return
      }
      if (opts.idleMs > 0) {
        state.timer = setTimer(() => {
          flush(sessionId, 'auto_idle')
        }, opts.idleMs)
      }
    },
    onEnd(sessionId) {
      const state = sessions.get(sessionId)
      if (state === undefined) return
      clearIdleTimer(state)
      sessions.delete(sessionId)
    },
    shutdown() {
      for (const state of sessions.values()) clearIdleTimer(state)
      sessions.clear()
    },
  }
}
