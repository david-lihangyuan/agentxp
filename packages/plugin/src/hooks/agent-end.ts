/**
 * agent-end.ts — agent_end hook.
 *
 * Consumes the tool call buffer accumulated by after_tool_call,
 * runs extraction, sanitizes, and stores any discovered lessons.
 * Cleans up the buffer after processing.
 */

import type { Db } from '../db.js'
import { extractFromToolCalls } from '../extraction-engine.js'
import { sanitizeBeforeStore } from '../sanitize.js'
import { toolCallBuffers } from './state.js'

// ─── Types (from SDK) ──────────────────────────────────────────────────────

export interface AgentEndEvent {
  messages: unknown[]
  success: boolean
  error?: string
  durationMs?: number
}

export interface AgentEndContext {
  runId?: string
  agentId?: string
  sessionKey?: string
  sessionId?: string
}

// ─── Hook factory ──────────────────────────────────────────────────────────

export function createAgentEndHook(db: Db) {
  return (event: AgentEndEvent, ctx: AgentEndContext): void => {
    try {
      const sessionKey = ctx.sessionKey ?? 'unknown'
      const buffer = toolCallBuffers.get(sessionKey)

      if (buffer && buffer.length >= 2) {
        const lesson = extractFromToolCalls(buffer)
        if (lesson) {
          const sanitized = sanitizeBeforeStore(lesson)
          db.insertLesson({
            ...sanitized,
            source: sanitized.source ?? 'local',
            tags: sanitized.tags ?? ['auto-extracted'],
          })
        }
      }

      // Always clean up the buffer
      toolCallBuffers.delete(sessionKey)
    } catch {
      // never throw — don't block the agent
    }
  }
}
