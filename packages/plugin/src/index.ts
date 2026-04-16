/**
 * index.ts — AgentXP OpenClaw Plugin entry point.
 *
 * Registers all capabilities: memory supplements, hooks, service,
 * tools, commands, CLI, and HTTP routes.
 */

import { resolveConfig } from './types.js'
import { createDb } from './db.js'
import { createCorpusSupplement } from './memory-corpus.js'
import { createPromptBuilder } from './memory-prompt.js'
import {
  createMessageSendingHook,
  createAfterToolCallHook,
  createAgentEndHook,
  createBeforeToolCallHook,
  createSessionStartHook,
  createSessionEndHook,
} from './hooks/index.js'
import { createService } from './service/index.js'
import { createSearchTool } from './tools/search.js'
import { createPublishTool } from './tools/publish.js'
import { createXpCommand } from './commands.js'
import { createCliRegistrar } from './cli.js'
import { registerRoutes } from './routes.js'
import { installIfNeeded } from './install.js'

// Plugin entry object. In production this is wrapped by definePluginEntry from
// openclaw/plugin-sdk/plugin-entry, but we export the plain shape directly so
// tests can import without the SDK being present.

const pluginEntry = {
  id: 'agentxp' as const,
  name: 'AgentXP' as const,
  description: 'Agent experience learning and sharing' as const,

  register(api: {
    pluginConfig?: Record<string, unknown>
    runtime?: { state?: { resolveStateDir?: () => string } }
    logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void }
    resolvePath?: (input: string) => string
    registerMemoryCorpusSupplement?: (supplement: unknown) => void
    registerMemoryPromptSupplement?: (builder: unknown) => void
    on?: (hookName: string, handler: unknown, opts?: unknown) => void
    registerService?: (service: unknown) => void
    registerTool?: (tool: unknown, opts?: unknown) => void
    registerCommand?: (command: unknown) => void
    registerCli?: (registrar: unknown, opts?: unknown) => void
    registerHttpRoute?: (params: unknown) => void
  }) {
    const config = resolveConfig(api.pluginConfig)
    const logger = api.logger ?? { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

    // Resolve DB path
    const stateDir = api.runtime?.state?.resolveStateDir?.() ?? ''
    const dbPath = stateDir && stateDir !== ':memory:' ? `${stateDir}/agentxp.db` : ':memory:'

    // Initialize DB
    const db = createDb(dbPath)

    // First-run install (idempotent)
    try {
      installIfNeeded(db, config, stateDir)
    } catch (err) {
      logger.warn(`[agentxp] install failed: ${err}`)
    }

    // ─── Memory Supplements ────────────────────────────────────────────

    if (api.registerMemoryCorpusSupplement) {
      api.registerMemoryCorpusSupplement(createCorpusSupplement(db, config))
    }

    if (api.registerMemoryPromptSupplement) {
      api.registerMemoryPromptSupplement(createPromptBuilder(db, config))
    }

    // ─── Hooks ─────────────────────────────────────────────────────────

    if (api.on) {
      api.on('message_sending', createMessageSendingHook(db))
      api.on('after_tool_call', createAfterToolCallHook())
      api.on('agent_end', createAgentEndHook(db))
      api.on('before_tool_call', createBeforeToolCallHook(db))
      api.on('session_start', createSessionStartHook())
      api.on('session_end', createSessionEndHook(db))
    }

    // ─── Background Service ────────────────────────────────────────────

    if (api.registerService) {
      api.registerService(createService(db, config))
    }

    // ─── Optional Tools ────────────────────────────────────────────────

    if (api.registerTool) {
      api.registerTool(createSearchTool(db), { optional: true })
      api.registerTool(createPublishTool(db), { optional: true })
    }

    // ─── Chat Commands ─────────────────────────────────────────────────

    if (api.registerCommand) {
      api.registerCommand(createXpCommand(db, config))
    }

    // ─── CLI ───────────────────────────────────────────────────────────

    if (api.registerCli) {
      api.registerCli(createCliRegistrar(db, config), {
        descriptors: [
          { name: 'agentxp', description: 'AgentXP experience learning management' },
        ],
      })
    }

    // ─── HTTP Routes ───────────────────────────────────────────────────

    if (api.registerHttpRoute) {
      registerRoutes(api, db, config)
    }

    logger.info(`[agentxp] plugin registered (mode: ${config.mode})`)
  },
}

export default pluginEntry
