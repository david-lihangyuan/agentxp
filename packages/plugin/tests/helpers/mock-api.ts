/**
 * mock-api.ts — Mock OpenClawPluginApi factory for testing.
 *
 * Covers all registration methods used by agentxp plugin.
 * Tests can call createMockApi() and then call plugin.register(api)
 * to inspect what was registered.
 */

export type PluginHookName =
  | 'before_model_resolve'
  | 'before_prompt_build'
  | 'before_agent_start'
  | 'before_agent_reply'
  | 'llm_input'
  | 'llm_output'
  | 'agent_end'
  | 'before_compaction'
  | 'after_compaction'
  | 'before_reset'
  | 'inbound_claim'
  | 'message_received'
  | 'message_sending'
  | 'message_sent'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'tool_result_persist'
  | 'before_message_write'
  | 'session_start'
  | 'session_end'
  | 'subagent_spawning'
  | 'subagent_delivery_target'
  | 'subagent_spawned'
  | 'subagent_ended'
  | 'gateway_start'
  | 'gateway_stop'
  | 'before_dispatch'
  | 'reply_dispatch'
  | 'before_install'

export interface MockApiCapture {
  corpusSupplements: unknown[]
  promptSupplements: unknown[]
  hooks: Map<string, ((...args: unknown[]) => unknown)[]>
  typedHooks: Map<string, ((...args: unknown[]) => unknown)[]>
  services: unknown[]
  tools: { tool: unknown; opts?: unknown }[]
  commands: unknown[]
  cliRegistrars: { registrar: unknown; opts?: unknown }[]
  httpRoutes: unknown[]
  gatewayMethods: { method: string; handler: unknown; opts?: unknown }[]
}

export interface MockPluginApi {
  id: string
  name: string
  source: string
  registrationMode: 'full'
  config: Record<string, unknown>
  pluginConfig: Record<string, unknown>
  runtime: Record<string, unknown>
  logger: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
    debug: (...args: unknown[]) => void
  }
  registerMemoryCorpusSupplement: (s: unknown) => void
  registerMemoryPromptSupplement: (b: unknown) => void
  registerHook: (events: string | string[], handler: (...args: unknown[]) => unknown) => void
  on: <K extends PluginHookName>(hookName: K, handler: (...args: unknown[]) => unknown) => void
  registerService: (s: unknown) => void
  registerTool: (t: unknown, opts?: unknown) => void
  registerCommand: (c: unknown) => void
  registerCli: (r: unknown, opts?: unknown) => void
  registerHttpRoute: (p: unknown) => void
  registerGatewayMethod: (method: string, handler: unknown, opts?: unknown) => void
  resolvePath: (p: string) => string
}

export function createMockApi(pluginConfig?: Record<string, unknown>): {
  api: MockPluginApi
  capture: MockApiCapture
} {
  const capture: MockApiCapture = {
    corpusSupplements: [],
    promptSupplements: [],
    hooks: new Map(),
    typedHooks: new Map(),
    services: [],
    tools: [],
    commands: [],
    cliRegistrars: [],
    httpRoutes: [],
    gatewayMethods: [],
  }

  const api: MockPluginApi = {
    id: 'agentxp',
    name: 'AgentXP',
    source: 'test',
    registrationMode: 'full' as const,
    config: {},
    pluginConfig: pluginConfig ?? {},
    runtime: {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    registerMemoryCorpusSupplement: (s: unknown) => {
      capture.corpusSupplements.push(s)
    },
    registerMemoryPromptSupplement: (b: unknown) => {
      capture.promptSupplements.push(b)
    },
    registerHook: (events: string | string[], handler: (...args: unknown[]) => unknown) => {
      const evts = Array.isArray(events) ? events : [events]
      for (const e of evts) {
        if (!capture.hooks.has(e)) capture.hooks.set(e, [])
        capture.hooks.get(e)!.push(handler)
      }
    },
    on: <K extends PluginHookName>(
      hookName: K,
      handler: (...args: unknown[]) => unknown,
    ) => {
      if (!capture.typedHooks.has(hookName)) capture.typedHooks.set(hookName, [])
      capture.typedHooks.get(hookName)!.push(handler)
    },
    registerService: (s: unknown) => {
      capture.services.push(s)
    },
    registerTool: (t: unknown, opts?: unknown) => {
      capture.tools.push({ tool: t, opts })
    },
    registerCommand: (c: unknown) => {
      capture.commands.push(c)
    },
    registerCli: (r: unknown, opts?: unknown) => {
      capture.cliRegistrars.push({ registrar: r, opts })
    },
    registerHttpRoute: (p: unknown) => {
      capture.httpRoutes.push(p)
    },
    registerGatewayMethod: (method: string, handler: unknown, opts?: unknown) => {
      capture.gatewayMethods.push({ method, handler, opts })
    },
    resolvePath: (p: string) => p,
  }

  return { api, capture }
}
