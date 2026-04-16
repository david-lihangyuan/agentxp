/**
 * session-lifecycle.ts — session_start and session_end hooks.
 *
 * session_start: no-op placeholder (can be used for cache prewarming later).
 * session_end: clears context_cache and tool call buffers for the session.
 */

import type { Db } from '../db.js'
import { toolCallBuffers } from './state.js'

// ─── Types (from SDK) ──────────────────────────────────────────────────────

export interface SessionStartEvent {
  sessionId: string
  sessionKey?: string
  resumedFrom?: string
}

export interface SessionEndEvent {
  sessionId: string
  sessionKey?: string
  messageCount?: number
  durationMs?: number
  reason?: string
}

export interface SessionContext {
  agentId?: string
  sessionId: string
  sessionKey?: string
}

// ─── Hook factories ────────────────────────────────────────────────────────

export function createSessionStartHook(_db: Db) {
  return (_event: SessionStartEvent, _ctx: SessionContext): void => {
    // No-op placeholder — can add cache prewarming later
  }
}

export function createSessionEndHook(db: Db) {
  return (_event: SessionEndEvent, ctx: SessionContext): void => {
    try {
      const sessionKey = ctx.sessionKey ?? ctx.sessionId
      if (sessionKey) {
        // Clear context cache from DB
        db.deleteContextCache(sessionKey)
        // Clear in-memory tool call buffer
        toolCallBuffers.delete(sessionKey)
      }
    } catch {
      // never throw — don't block session cleanup
    }
  }
}
