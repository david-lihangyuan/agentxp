import { describe, it, expect } from 'vitest'
import { createMockApi } from './helpers/mock-api.js'

describe('plugin entry', () => {
  it('exports a valid plugin definition', async () => {
    const mod = await import('../src/index.js')
    const entry = mod.default
    expect(entry).toBeDefined()
    expect(entry.id).toBe('agentxp')
    expect(entry.name).toBe('AgentXP')
    expect(typeof entry.register).toBe('function')
  })

  it('has correct description', async () => {
    const mod = await import('../src/index.js')
    const entry = mod.default
    expect(entry.description).toBe('Agent experience learning and sharing')
  })

  it('register() runs without error with mock api', async () => {
    const mod = await import('../src/index.js')
    const entry = mod.default
    const { api } = createMockApi()
    expect(() => entry.register(api)).not.toThrow()
  })

  it('register() respects pluginConfig mode override', async () => {
    const mod = await import('../src/index.js')
    const entry = mod.default
    const { api } = createMockApi({ mode: 'network', relayUrl: 'https://custom.relay.io' })
    // Should not throw with custom config
    expect(() => entry.register(api)).not.toThrow()
  })
})

describe('resolveConfig', () => {
  it('returns defaults when no config given', async () => {
    const { resolveConfig, DEFAULT_CONFIG } = await import('../src/types.js')
    const cfg = resolveConfig(undefined)
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  it('merges partial config over defaults', async () => {
    const { resolveConfig } = await import('../src/types.js')
    const cfg = resolveConfig({ mode: 'network' })
    expect(cfg.mode).toBe('network')
    expect(cfg.relayUrl).toBe('https://relay.agentxp.io')
    expect(cfg.maxInjectionTokens).toBe(500)
  })

  it('preserves all default fields', async () => {
    const { resolveConfig } = await import('../src/types.js')
    const cfg = resolveConfig({})
    expect(cfg.mode).toBe('local')
    expect(cfg.autoPublish).toBe(false)
    expect(cfg.weaning).toEqual({ enabled: true, rate: 0.1 })
    expect(cfg.weeklyDigest).toBe(true)
  })
})
