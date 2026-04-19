// OpenClaw host adapter (M7 Batch 1). Wires the AgentXP hook-set into
// the OpenClaw plugin runtime via api.on(...). The host-agnostic hook
// functions in ./hooks.js are unchanged; this file only translates
// between OpenClaw's event/ctx shapes and our internal shapes.
//
// Six api.on(...) registrations across five OpenClaw hook names:
//   session_start, before_tool_call (x2: block gate + tier-1 signal),
//   after_tool_call, session_end, agent_end.
import { definePluginEntry, emptyPluginConfigSchema } from 'openclaw/plugin-sdk/core'
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core'

import type { PluginDb } from './db.js'
import {
  onAgentEnd,
  onBeforeToolCall,
  onMessageSending,
  onSessionEnd,
  onSessionStart,
  onToolCall,
} from './hooks.js'
import type { SessionSummaryInput } from './hooks.js'
import { createCorpusSupplement } from './memory-corpus.js'
import { createPromptBuilder } from './memory-prompt.js'

export const AGENTXP_PLUGIN_ID = 'agentxp'
export const AGENTXP_PLUGIN_NAME = 'AgentXP'
export const AGENTXP_PLUGIN_DESCRIPTION =
  'Capture agent reasoning traces and publish experiences to the AgentXP relay.'

// Default summary used when session_end fires without the host
// providing a human-authored summary. Implicit session endings go out
// tagged as inconclusive; real summaries are expected to ride in via
// an explicit reflect CLI in a future milestone.
const IMPLICIT_SUMMARY: SessionSummaryInput = {
  what: 'agent session (implicit end)',
  tried: 'tool calls captured across the session',
  outcome: 'inconclusive',
  learned: 'no explicit reflection; trace preserved for later review',
}

// Host event shapes. Intentionally duck-typed so the adapter is
// callable in tests with minimal mocks and does not drag the full
// OpenClaw type graph into our public API.
interface SessionStartEventLike {
  sessionId: string
  resumedFrom?: string
}
interface SessionEndEventLike {
  sessionId: string
  messageCount?: number
  durationMs?: number
  reason?: string
}
interface BeforeToolCallEventLike {
  toolName: string
  params: Record<string, unknown>
  toolCallId?: string
}
interface AfterToolCallEventLike {
  toolName: string
  params: Record<string, unknown>
  result?: unknown
  error?: string
  durationMs?: number
  toolCallId?: string
}
interface AgentEndEventLike {
  messages: unknown[]
  success: boolean
  error?: string
  durationMs?: number
}
interface ToolContextLike {
  sessionId?: string
  toolName?: string
  toolCallId?: string
}
interface SessionContextLike {
  sessionId: string
  sessionKey?: string
}
interface AgentContextLike {
  sessionId?: string
}

function mapSessionEndReason(raw: string | undefined): 'exit' | 'idle' | 'explicit' {
  if (raw === 'idle') return 'idle'
  if (raw === 'explicit') return 'explicit'
  return 'exit'
}

export function createAgentxpPluginRegister(
  db: PluginDb,
): (api: OpenClawPluginApi) => void {
  return (api) => {
    api.on('session_start', (event: SessionStartEventLike) => {
      onSessionStart(db, {
        session_id: event.sessionId,
        ...(event.resumedFrom !== undefined ? { resumed_from: event.resumedFrom } : {}),
      })
    })

    api.on(
      'before_tool_call',
      (event: BeforeToolCallEventLike, ctx: ToolContextLike) => {
        const sig = onBeforeToolCall({
          session_id: ctx.sessionId ?? 'unknown',
          tool_name: event.toolName,
          arguments: event.params,
          ...(event.toolCallId !== undefined ? { tool_call_id: event.toolCallId } : {}),
        })
        if (sig.blocked) {
          return { block: true, blockReason: sig.block_reason ?? 'blocked by agentxp' }
        }
        return undefined
      },
      { priority: 10 },
    )

    api.on(
      'before_tool_call',
      (event: BeforeToolCallEventLike, ctx: ToolContextLike) => {
        onMessageSending({
          session_id: ctx.sessionId ?? 'unknown',
          tool_call: { name: event.toolName, arguments: event.params },
          created_at: new Date().toISOString(),
        })
        return undefined
      },
      { priority: 20 },
    )

    api.on('after_tool_call', (event: AfterToolCallEventLike, ctx: ToolContextLike) => {
      onToolCall(db, {
        session_id: ctx.sessionId ?? 'unknown',
        created_at: new Date().toISOString(),
        tool_call: {
          name: event.toolName,
          arguments: event.params,
          result: event.result ?? event.error ?? '',
          duration_ms: event.durationMs ?? 0,
        },
      })
    })

    api.on('session_end', (event: SessionEndEventLike, _ctx: SessionContextLike) => {
      onSessionEnd(
        db,
        {
          session_id: event.sessionId,
          ended_at: new Date().toISOString(),
          reason: mapSessionEndReason(event.reason),
        },
        IMPLICIT_SUMMARY,
      )
    })

    api.on('agent_end', (event: AgentEndEventLike, ctx: AgentContextLike) => {
      if (!ctx.sessionId) return
      onAgentEnd(db, {
        session_id: ctx.sessionId,
        success: event.success,
        ...(event.durationMs !== undefined ? { duration_ms: event.durationMs } : {}),
        ...(event.error !== undefined ? { error: event.error } : {}),
      })
    })

    // M7 Batch 2 — memory supplements. The corpus exposes staged
    // experiences for the host's memory search; the prompt builder
    // injects a "## Past AgentXP Experiences" section keyed off the
    // shared session-state populated by onMessageSending.
    api.registerMemoryCorpusSupplement(createCorpusSupplement(db))
    api.registerMemoryPromptSupplement(createPromptBuilder(db))
  }
}

// Host-facing entry. OpenClaw loads this by importing the module and
// looking for a default-shaped `definePluginEntry` return value. The
// register() closure here is responsible for opening the staging DB
// and wiring the adapter; for now we leave the DB open to the host's
// integration layer (Batch 2 will source the path from api.config).
export const agentxpPlugin = definePluginEntry({
  id: AGENTXP_PLUGIN_ID,
  name: AGENTXP_PLUGIN_NAME,
  description: AGENTXP_PLUGIN_DESCRIPTION,
  configSchema: emptyPluginConfigSchema(),
  register(_api) {
    throw new Error(
      'agentxpPlugin.register requires a PluginDb wired by the host loader; ' +
        'call createAgentxpPluginRegister(db)(api) from the host entry instead. ' +
        'Full wiring lands in Batch 2.',
    )
  },
})

export default agentxpPlugin
