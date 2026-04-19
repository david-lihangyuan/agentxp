// M7 Batch 1 — OpenClaw adapter integration.
// Exercises the register(api) closure against a mock OpenClawPluginApi
// that captures hook registrations and allows the test to invoke any
// registered handler with a synthetic event + ctx shaped like the real
// OpenClaw host would fire.
import { describe, it, expect } from 'vitest'
import { openPluginDb } from '../src/db.js'
import { createAgentxpPluginRegister, AGENTXP_PLUGIN_ID } from '../src/adapter.js'

type Registration = { hook: string; handler: Function; opts?: { priority?: number } }

interface MockApi {
  id: string
  registrations: Registration[]
  on: (hook: string, handler: Function, opts?: { priority?: number }) => void
  invoke: (hook: string, event: unknown, ctx: unknown) => unknown
  invokeAll: (hook: string, event: unknown, ctx: unknown) => unknown[]
}

function mockApi(): MockApi {
  const registrations: Registration[] = []
  return {
    id: AGENTXP_PLUGIN_ID,
    registrations,
    on(hook, handler, opts) {
      registrations.push(opts === undefined ? { hook, handler } : { hook, handler, opts })
    },
    invoke(hook, event, ctx) {
      const r = registrations.find((x) => x.hook === hook)
      if (!r) throw new Error(`no handler for ${hook}`)
      return r.handler(event, ctx)
    },
    invokeAll(hook, event, ctx) {
      return registrations
        .filter((x) => x.hook === hook)
        .sort((a, b) => (a.opts?.priority ?? 100) - (b.opts?.priority ?? 100))
        .map((r) => r.handler(event, ctx))
    },
  }
}

describe('OpenClaw adapter — createAgentxpPluginRegister', () => {
  it('registers handlers on all five OpenClaw hook names (session_start, before_tool_call, after_tool_call, session_end, agent_end)', () => {
    const db = openPluginDb(':memory:')
    try {
      const api = mockApi()
      createAgentxpPluginRegister(db)(api as never)
      const hooks = new Set(api.registrations.map((r) => r.hook))
      expect(hooks).toEqual(
        new Set([
          'session_start',
          'before_tool_call',
          'after_tool_call',
          'session_end',
          'agent_end',
        ]),
      )
      // before_tool_call gets two handlers (block gate + tier-1 signal)
      const btc = api.registrations.filter((r) => r.hook === 'before_tool_call')
      expect(btc.length).toBe(2)
      expect(api.registrations.length).toBe(6)
    } finally {
      db.close()
    }
  })

  it('before_tool_call gate returns { block, blockReason } for a destructive cmd', () => {
    const db = openPluginDb(':memory:')
    try {
      const api = mockApi()
      createAgentxpPluginRegister(db)(api as never)

      const event = {
        toolName: 'bash',
        params: { cmd: 'rm -rf /var' },
        toolCallId: 'tc-1',
      }
      const ctx = { sessionId: 'sess-a', toolName: 'bash', toolCallId: 'tc-1' }
      const results = api.invokeAll('before_tool_call', event, ctx)
      const blocking = results.find(
        (r): r is { block: true; blockReason: string } =>
          typeof r === 'object' && r !== null && (r as { block?: unknown }).block === true,
      )
      expect(blocking).toBeDefined()
      expect(blocking?.blockReason).toMatch(/destructive/i)
    } finally {
      db.close()
    }
  })

  it('end-to-end: session_start → 2×after_tool_call → session_end stages one experience with 2 trace steps', () => {
    const db = openPluginDb(':memory:')
    try {
      const api = mockApi()
      createAgentxpPluginRegister(db)(api as never)
      const SESSION = 'sess-e2e'
      const sctx = { sessionId: SESSION }

      api.invoke('session_start', { sessionId: SESSION }, sctx)
      api.invoke(
        'after_tool_call',
        {
          toolName: 'bash',
          params: { cmd: 'ls' },
          result: 'a\nb',
          durationMs: 100,
        },
        { sessionId: SESSION, toolName: 'bash' },
      )
      api.invoke(
        'after_tool_call',
        {
          toolName: 'read_file',
          params: { path: '/etc/hosts' },
          result: '127.0.0.1 localhost',
          durationMs: 50,
        },
        { sessionId: SESSION, toolName: 'read_file' },
      )
      api.invoke(
        'session_end',
        {
          sessionId: SESSION,
          messageCount: 4,
          reason: 'new',
          durationMs: 1000,
        },
        sctx,
      )

      const staged = db.listAllExperiences()
      expect(staged.length).toBe(1)
      const trace = JSON.parse(staged[0]!.trace_json) as { steps: unknown[] }
      expect(trace.steps.length).toBe(2)
    } finally {
      db.close()
    }
  })

  it('agent_end after an unclosed session drops orphan trace steps', () => {
    const db = openPluginDb(':memory:')
    try {
      const api = mockApi()
      createAgentxpPluginRegister(db)(api as never)
      const SESSION = 'sess-orphan'

      api.invoke('session_start', { sessionId: SESSION }, { sessionId: SESSION })
      api.invoke(
        'after_tool_call',
        { toolName: 'bash', params: {}, result: 'ok', durationMs: 10 },
        { sessionId: SESSION, toolName: 'bash' },
      )
      expect(db.listTraceSteps(SESSION).length).toBe(1)

      api.invoke(
        'agent_end',
        { messages: [], success: false, error: 'killed', durationMs: 500 },
        { sessionId: SESSION },
      )
      expect(db.listTraceSteps(SESSION).length).toBe(0)
      expect(db.listAllExperiences().length).toBe(0)
    } finally {
      db.close()
    }
  })
})
