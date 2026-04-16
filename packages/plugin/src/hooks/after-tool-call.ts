/**
 * after-tool-call.ts — after_tool_call hook.
 *
 * Accumulates tool call results into an in-memory buffer per session.
 * Does NOT store raw params — only safe metadata.
 * Buffer is consumed by agent_end and cleared by session_end.
 */

import { basename } from 'node:path'
import type { ToolCallRecord } from '../extraction-engine.js'
import { toolCallBuffers } from './state.js'

// ─── Types (from SDK) ──────────────────────────────────────────────────────

export interface AfterToolCallEvent {
  toolName: string
  params: Record<string, unknown>
  runId?: string
  toolCallId?: string
  result?: unknown
  error?: string
  durationMs?: number
}

export interface ToolCallContext {
  agentId?: string
  sessionKey?: string
  sessionId?: string
  runId?: string
  toolName: string
  toolCallId?: string
}

// ─── Safe metadata extraction ──────────────────────────────────────────────

/** Buffer limit per session */
const MAX_BUFFER_SIZE = 50

/**
 * Extract safe metadata from tool params — no raw content, only structural info.
 * - read/write/edit: basename of path
 * - exec: first command token
 */
function extractSafeMeta(
  toolName: string,
  params: Record<string, unknown>,
): { path?: string } {
  const meta: { path?: string } = {}

  // For read/write/edit — extract basename only
  if (
    (toolName === 'read' || toolName === 'write' || toolName === 'edit') &&
    typeof params.path === 'string'
  ) {
    meta.path = basename(params.path)
  }

  return meta
}

/**
 * Extract the first meaningful token from an error string as a signature.
 */
function extractErrorSignature(error: string): string {
  // Try to match a known error name (e.g. TypeError, ENOENT)
  const nameMatch = error.match(/([A-Z][a-zA-Z]*Error|E[A-Z]{2,})/)
  if (nameMatch) return nameMatch[1]
  // Fallback: first 60 chars
  return error.slice(0, 60)
}

/**
 * Extract safe info from exec command — first token only.
 */
function extractExecCmd(params: Record<string, unknown>): string | undefined {
  if (typeof params.command === 'string') {
    return params.command.split(/\s/)[0] || undefined
  }
  return undefined
}

// ─── Hook factory ──────────────────────────────────────────────────────────

export function createAfterToolCallHook() {
  return (event: AfterToolCallEvent, ctx: ToolCallContext): void => {
    try {
      const sessionKey = ctx.sessionKey ?? 'unknown'

      if (!toolCallBuffers.has(sessionKey)) {
        toolCallBuffers.set(sessionKey, [])
      }

      const safeMeta = extractSafeMeta(event.toolName, event.params)
      const execCmd = extractExecCmd(event.params)

      // Build a ToolCallRecord compatible with extraction-engine
      const record: ToolCallRecord = {
        toolName: event.toolName,
        params: safeMeta,
        error: event.error,
        durationMs: event.durationMs,
        // Store a minimal result string for pattern matching,
        // but not raw content — only enough for extractFromToolCalls
        result: event.error
          ? undefined
          : (typeof event.result === 'string'
            ? event.result.slice(0, 200)
            : event.result != null ? 'ok' : undefined),
      }

      // Attach exec command token as metadata on the record
      if (execCmd && !safeMeta.path) {
        record.params = { ...record.params, path: execCmd }
      }

      const buf = toolCallBuffers.get(sessionKey)!
      buf.push(record)

      // Limit buffer size — keep most recent entries
      if (buf.length > MAX_BUFFER_SIZE) {
        buf.splice(0, buf.length - MAX_BUFFER_SIZE)
      }
    } catch {
      // never throw — don't block the agent
    }
  }
}
