/**
 * state.ts — Shared in-memory state for hooks.
 *
 * Houses the tool call buffers (shared between after_tool_call and agent_end)
 * and the last active session key (for memory-prompt integration).
 */

import type { ToolCallRecord } from '../extraction-engine.js'

/**
 * Per-session tool call buffer.
 * Populated by after_tool_call, consumed by agent_end, cleared by session_end.
 */
export const toolCallBuffers = new Map<string, ToolCallRecord[]>()

/**
 * Get the tool call buffer for a session key.
 * Returns undefined if no buffer exists.
 */
export function getToolCallBuffer(sessionKey: string): ToolCallRecord[] | undefined {
  return toolCallBuffers.get(sessionKey)
}

/**
 * Last active session key — used by memory-prompt to know which session
 * to pull context for.
 */
let _lastActiveSession: string | undefined

export function setLastActiveSession(sessionKey: string): void {
  _lastActiveSession = sessionKey
}

export function getLastActiveSession(): string | undefined {
  return _lastActiveSession
}

/**
 * Reset all shared state. For testing only.
 */
export function resetState(): void {
  toolCallBuffers.clear()
  _lastActiveSession = undefined
}
