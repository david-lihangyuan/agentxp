/**
 * before-tool-call.ts — before_tool_call hook.
 *
 * Records a trace step for each tool call (toolName + normalized action).
 * Does NOT store raw params — only structural info.
 * Returns void — does not modify or block the call.
 */

import type { Db } from '../db.js'

// ─── Types (from SDK) ──────────────────────────────────────────────────────

export interface BeforeToolCallEvent {
  toolName: string
  params: Record<string, unknown>
  runId?: string
  toolCallId?: string
}

export interface BeforeToolCallContext {
  agentId?: string
  sessionKey?: string
  sessionId?: string
  runId?: string
  toolName: string
  toolCallId?: string
}

// ─── Action normalization ──────────────────────────────────────────────────

/**
 * Normalize a tool name into a human-readable action string.
 * e.g. "read" → "file:read", "exec" → "shell:exec"
 */
export function normalizeAction(toolName: string): string {
  switch (toolName) {
    case 'read':
      return 'file:read'
    case 'write':
      return 'file:write'
    case 'edit':
      return 'file:edit'
    case 'exec':
      return 'shell:exec'
    case 'process':
      return 'shell:process'
    case 'web_fetch':
      return 'web:fetch'
    case 'image':
      return 'media:image'
    case 'image_generate':
      return 'media:generate'
    case 'memory_search':
      return 'memory:search'
    case 'memory_get':
      return 'memory:get'
    default:
      return `tool:${toolName}`
  }
}

// ─── Hook factory ──────────────────────────────────────────────────────────

export function createBeforeToolCallHook(db: Db) {
  return (event: BeforeToolCallEvent, ctx: BeforeToolCallContext): void => {
    try {
      db.insertTraceStep({
        sessionId: ctx.sessionKey ?? 'unknown',
        action: normalizeAction(event.toolName),
        toolName: event.toolName,
        significance: 'routine',
        timestamp: Date.now(),
      })
    } catch {
      // never throw — don't block the tool call
    }
  }
}
