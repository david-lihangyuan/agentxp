/**
 * memory-prompt.ts — MemoryPromptSectionBuilder for AgentXP.
 *
 * Injects relevant past experiences into the agent's system prompt
 * via OpenClaw's Memory Prompt Supplement interface.
 *
 * Uses a module-level "last active session" workaround since the builder
 * signature doesn't include sessionKey. The message_sending hook (Task 8)
 * calls setLastActiveSession() to keep this fresh.
 */

import type { Db } from './db.js'
import type { PluginConfig } from './types.js'
import { selectExperiences, inferPhase } from './injection-engine.js'

// ─── SDK-compatible type (defined locally) ─────────────────────────────────

export type MemoryPromptSectionBuilder = (params: {
  availableTools: Set<string>
  citationsMode?: string
}) => string[]

// ─── Module-level state ────────────────────────────────────────────────────

let _lastActiveSessionKey: string | null = null
let _lastActiveTimestamp = 0

/** Staleness threshold in milliseconds (30 seconds) */
const STALE_THRESHOLD_MS = 30_000

/**
 * Called by message_sending hook to track which session is currently active.
 */
export function setLastActiveSession(sessionKey: string): void {
  _lastActiveSessionKey = sessionKey
  _lastActiveTimestamp = _nowFn()
}

/**
 * Reset module state. For testing only.
 */
export function resetLastActiveSession(): void {
  _lastActiveSessionKey = null
  _lastActiveTimestamp = 0
}

// ─── Internals exposed for testing ─────────────────────────────────────────

/** Override Date.now for deterministic tests. */
export let _nowFn: () => number = () => Date.now()

export function _setNowFn(fn: () => number): void {
  _nowFn = fn
}

export function _resetNowFn(): void {
  _nowFn = () => Date.now()
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createPromptBuilder(
  db: Db,
  config: PluginConfig,
  /** Override Math.random for testing (disables weaning at 0.99) */
  _randomFn?: () => number,
): MemoryPromptSectionBuilder {
  return ({ availableTools, citationsMode }) => {
    // Guard: no active session or stale → skip
    if (
      !_lastActiveSessionKey ||
      _nowFn() - _lastActiveTimestamp > STALE_THRESHOLD_MS
    ) {
      return []
    }

    // Fetch keywords from context cache for the active session
    const cache = db.getContextCache(_lastActiveSessionKey)
    if (!cache || cache.keywords.length === 0) {
      return []
    }

    const keywords = cache.keywords

    // Run the injection engine
    const result = selectExperiences({
      keywords,
      phase: inferPhase(keywords),
      db,
      config,
      _randomFn,
    })

    if (!result.injected) {
      return []
    }

    // Record injection log
    db.insertInjectionLog({
      sessionId: _lastActiveSessionKey,
      injected: true,
      tokenCount: result.tokenEstimate,
      lessonIds: result.lessonIds,
    })

    return result.lines
  }
}
