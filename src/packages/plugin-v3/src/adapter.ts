// OpenClaw host adapter (M7 Batch 1). Wires the AgentXP hook-set into
// the OpenClaw plugin runtime via api.on(...). The host-agnostic hook
// functions in ./hooks.js are unchanged; this file only translates
// between OpenClaw's event/ctx shapes and our internal shapes.
//
// Six api.on(...) registrations across five OpenClaw hook names:
//   session_start, before_tool_call (x2: block gate + tier-1 signal),
//   after_tool_call, session_end, agent_end.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import type { AgentKey } from '@serendip/protocol'
import { definePluginEntry, emptyPluginConfigSchema } from 'openclaw/plugin-sdk/core'
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core'

import { resolvePluginConfig } from './config.js'
import { openPluginDb, type PluginDb } from './db.js'
import { createFlushController, type FlushController } from './flush.js'
import {
  onAgentEnd,
  onBeforeToolCall,
  onMessageSending,
  onSessionEnd,
  onSessionStart,
  onToolCall,
} from './hooks.js'
import type { SessionSummaryInput } from './hooks.js'
import { AgentKeyLoadError, loadAgentKey } from './identity.js'
import { createCorpusSupplement } from './memory-corpus.js'
import { createPromptBuilder } from './memory-prompt.js'
import {
  startPublishLoop,
  type PublishLoopHandle,
} from './publish-loop.js'

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

// Auto-flush fallback options. Both thresholds default to 0 (disabled)
// so legacy tests and direct callers see no behaviour change; the
// definePluginEntry register() below passes the real defaults from
// resolvePluginConfig.
export interface AgentxpPublisherOptions {
  agent: AgentKey
  relayUrl: string
  intervalMs: number
  fetch?: typeof globalThis.fetch
}

export interface AgentxpRegisterOptions {
  autoFlushSteps?: number
  autoFlushIdleMs?: number
  // When set, the adapter starts a background publish loop that
  // drains staged_experiences to the relay. Tests that only exercise
  // hook wiring leave this undefined to avoid any network activity.
  publisher?: AgentxpPublisherOptions
}

// Tracks any side-effecting resources the adapter started so callers
// (tests, hot-reload code paths) can shut them down.
export interface AgentxpRegisterHandle {
  publisher?: PublishLoopHandle
}

export function createAgentxpPluginRegister(
  db: PluginDb,
  options: AgentxpRegisterOptions = {},
): ((api: OpenClawPluginApi) => void) & { handle: AgentxpRegisterHandle } {
  const flush: FlushController = createFlushController({
    db,
    countThreshold: options.autoFlushSteps ?? 0,
    idleMs: options.autoFlushIdleMs ?? 0,
    summary: IMPLICIT_SUMMARY,
  })
  const handle: AgentxpRegisterHandle = {}
  const register = (api: OpenClawPluginApi): void => {
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
      const sessionId = ctx.sessionId ?? 'unknown'
      onToolCall(db, {
        session_id: sessionId,
        created_at: new Date().toISOString(),
        tool_call: {
          name: event.toolName,
          arguments: event.params,
          result: event.result ?? event.error ?? '',
          duration_ms: event.durationMs ?? 0,
        },
      })
      // Auto-flush fallback: some OpenClaw exit paths never fire
      // session_end. Drive staging off tool-call counts / idle time
      // as well so traces don't get orphaned in trace_steps forever.
      flush.onStep(sessionId)
    })

    api.on('session_end', (event: SessionEndEventLike, _ctx: SessionContextLike) => {
      flush.onEnd(event.sessionId)
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
      flush.onEnd(ctx.sessionId)
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

    // M7 Batch 2.7 — background relay publisher. Drains staged
    // experiences on a timer so capture stays off the hot path and
    // transient relay outages don't block tool calls.
    if (options.publisher && options.publisher.intervalMs > 0) {
      handle.publisher = startPublishLoop({
        db,
        agent: options.publisher.agent,
        relayUrl: options.publisher.relayUrl,
        intervalMs: options.publisher.intervalMs,
        ...(options.publisher.fetch ? { fetch: options.publisher.fetch } : {}),
      })
    }
  }
  return Object.assign(register, { handle })
}

// Opens the staging DB at the configured path, creating the parent
// directory if necessary. Exported for tests that want to exercise
// the register-flow without standing up the full OpenClawPluginApi.
export function openDbFromConfig(stagingDbPath: string): PluginDb {
  try {
    mkdirSync(dirname(stagingDbPath), { recursive: true })
  } catch (err) {
    throw new Error(
      `agentxp plugin: cannot create directory for stagingDbPath ` +
        `(${stagingDbPath}): ${(err as Error).message}`,
    )
  }
  return openPluginDb(stagingDbPath)
}

// Loads the agent key used for signing published experiences. Returns
// null on any recoverable failure (missing key file, delegation
// mismatch, malformed metadata) so the plugin still captures traces —
// only the background publisher is suppressed. We log a single
// user-readable line rather than throwing, because publishing is a
// side-concern of the capture hot path.
function tryLoadAgentKey(
  agentKeyPath: string,
  operatorPublicKey: string,
): AgentKey | null {
  try {
    return loadAgentKey(agentKeyPath, operatorPublicKey)
  } catch (err) {
    if (err instanceof AgentKeyLoadError) {
      console.warn(`[agentxp] publisher disabled: ${err.message}`)
      return null
    }
    console.warn(
      `[agentxp] publisher disabled: unexpected error loading agent key: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

// Host-facing entry. OpenClaw loads this by importing the module and
// looking for a default-shaped `definePluginEntry` return value. The
// register() closure here resolves pluginConfig, opens the staging
// DB, loads the agent key, and hands the api off to
// createAgentxpPluginRegister with a publisher option when the key is
// available and publishIntervalMs > 0.
export const agentxpPlugin = definePluginEntry({
  id: AGENTXP_PLUGIN_ID,
  name: AGENTXP_PLUGIN_NAME,
  description: AGENTXP_PLUGIN_DESCRIPTION,
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    const cfg = resolvePluginConfig(api.pluginConfig)
    const db = openDbFromConfig(cfg.stagingDbPath)
    const registerOptions: AgentxpRegisterOptions = {
      autoFlushSteps: cfg.autoFlushSteps,
      autoFlushIdleMs: cfg.autoFlushIdleMs,
    }
    if (cfg.publishIntervalMs > 0) {
      const agent = tryLoadAgentKey(cfg.agentKeyPath, cfg.operatorPublicKey)
      if (agent) {
        registerOptions.publisher = {
          agent,
          relayUrl: cfg.relayUrl,
          intervalMs: cfg.publishIntervalMs,
        }
      }
    }
    createAgentxpPluginRegister(db, registerOptions)(api)
  },
})

export default agentxpPlugin
