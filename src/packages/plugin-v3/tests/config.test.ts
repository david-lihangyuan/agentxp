// Contract for resolvePluginConfig (M7 Batch 2.5). Mirrors the
// configSchema declared in openclaw.plugin.json; applies defaults
// for optional fields, validates operatorPublicKey, expands ~/ in
// path-typed fields. Errors are user-readable.
import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { resolvePluginConfig } from '../src/config.js'

const VALID_KEY = 'a'.repeat(64)

describe('resolvePluginConfig', () => {
  it('fills in defaults for every optional field when only operatorPublicKey is supplied', () => {
    const resolved = resolvePluginConfig({ operatorPublicKey: VALID_KEY })
    expect(resolved.operatorPublicKey).toBe(VALID_KEY)
    expect(resolved.relayUrl).toBe('https://relay.agentxp.io')
    expect(resolved.defaultVisibility).toBe('unlisted')
    // Path defaults should have ~/ expanded already
    expect(resolved.agentKeyPath.startsWith('~')).toBe(false)
    expect(resolved.agentKeyPath.startsWith(homedir())).toBe(true)
    expect(resolved.stagingDbPath.startsWith(homedir())).toBe(true)
  })

  it('throws a user-readable error when pluginConfig is missing', () => {
    expect(() => resolvePluginConfig(undefined)).toThrowError(/pluginConfig/i)
  })

  it('throws when operatorPublicKey is missing', () => {
    expect(() => resolvePluginConfig({})).toThrowError(/operatorPublicKey/)
  })

  it('throws when operatorPublicKey is not 64 hex chars', () => {
    expect(() => resolvePluginConfig({ operatorPublicKey: 'short' })).toThrowError(/hex/i)
    expect(() =>
      resolvePluginConfig({ operatorPublicKey: 'z'.repeat(64) }),
    ).toThrowError(/hex/i)
  })

  it('normalises operatorPublicKey to lower-case', () => {
    const upper = 'A'.repeat(64)
    expect(resolvePluginConfig({ operatorPublicKey: upper }).operatorPublicKey).toBe(
      'a'.repeat(64),
    )
  })

  it('passes through supplied overrides (relayUrl, defaultVisibility)', () => {
    const resolved = resolvePluginConfig({
      operatorPublicKey: VALID_KEY,
      relayUrl: 'https://example.test',
      defaultVisibility: 'public',
    })
    expect(resolved.relayUrl).toBe('https://example.test')
    expect(resolved.defaultVisibility).toBe('public')
  })

  it('rejects an unknown defaultVisibility value', () => {
    expect(() =>
      resolvePluginConfig({ operatorPublicKey: VALID_KEY, defaultVisibility: 'secret' }),
    ).toThrowError(/visibility/i)
  })

  it('expands ~/ prefix in agentKeyPath and stagingDbPath', () => {
    const resolved = resolvePluginConfig({
      operatorPublicKey: VALID_KEY,
      agentKeyPath: '~/custom/agent.key',
      stagingDbPath: '~/custom/staging.db',
    })
    expect(resolved.agentKeyPath).toBe(`${homedir()}/custom/agent.key`)
    expect(resolved.stagingDbPath).toBe(`${homedir()}/custom/staging.db`)
  })

  it('leaves absolute paths untouched', () => {
    const resolved = resolvePluginConfig({
      operatorPublicKey: VALID_KEY,
      agentKeyPath: '/abs/a.key',
      stagingDbPath: '/abs/s.db',
    })
    expect(resolved.agentKeyPath).toBe('/abs/a.key')
    expect(resolved.stagingDbPath).toBe('/abs/s.db')
  })

  it('rejects unexpected field types', () => {
    expect(() =>
      resolvePluginConfig({ operatorPublicKey: VALID_KEY, relayUrl: 42 }),
    ).toThrowError(/relayUrl/)
    expect(() =>
      resolvePluginConfig({ operatorPublicKey: VALID_KEY, stagingDbPath: [] }),
    ).toThrowError(/stagingDbPath/)
  })
})
