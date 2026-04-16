import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runKeyManager } from '../../src/service/key-manager.js'
import type { PluginConfig } from '../../src/types.js'
import type { PluginLogger } from '../../src/service/types.js'

function mockLogger(): PluginLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

const config: PluginConfig = {
  mode: 'network',
  relayUrl: 'https://relay.test',
  maxInjectionTokens: 500,
  autoPublish: true,
  weaning: { enabled: true, rate: 0.1 },
  weeklyDigest: true,
}

describe('runKeyManager', () => {
  let logger: PluginLogger

  beforeEach(() => {
    logger = mockLogger()
  })

  it('returns valid status when key is fresh', async () => {
    const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, expiresAt: farFuture }),
    })

    const result = await runKeyManager(null, config, logger, fetchFn as any)

    expect(result.valid).toBe(true)
    expect(result.renewed).toBeUndefined()
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('key is valid'),
    )
  })

  it('triggers renewal when key expires within 7 days', async () => {
    const soonExpiry = Date.now() + 3 * 24 * 60 * 60 * 1000 // 3 days
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true, expiresAt: soonExpiry }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })

    const result = await runKeyManager(null, config, logger, fetchFn as any)

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn).toHaveBeenCalledWith(
      'https://relay.test/v1/key/renew',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.renewed).toBe(true)
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('key renewed successfully'),
    )
  })

  it('handles renewal failure', async () => {
    const soonExpiry = Date.now() + 2 * 24 * 60 * 60 * 1000
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true, expiresAt: soonExpiry }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      })

    const result = await runKeyManager(null, config, logger, fetchFn as any)

    expect(result.valid).toBe(false)
    expect(result.renewed).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('renewal failed'),
    )
  })

  it('triggers renewal when key is invalid', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })

    const result = await runKeyManager(null, config, logger, fetchFn as any)

    expect(result.renewed).toBe(true)
  })

  it('handles status check failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 })

    const result = await runKeyManager(null, config, logger, fetchFn as any)

    expect(result.valid).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('status check failed'),
    )
  })

  it('throws on fetch exception', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('dns fail'))

    await expect(
      runKeyManager(null, config, logger, fetchFn as any),
    ).rejects.toThrow('dns fail')
  })
})
