/**
 * key-manager.ts — Check key expiry → auto-renew.
 *
 * Monitors Serendip relay key expiration and triggers renewal.
 * Uses _fetchFn for test injection.
 */

import type { PluginConfig } from '../types.js'
import type { PluginLogger } from './types.js'

export type FetchFn = typeof globalThis.fetch

export interface KeyStatus {
  valid: boolean
  expiresAt?: number
  renewed?: boolean
}

export async function runKeyManager(
  _db: unknown,
  config: PluginConfig,
  logger: PluginLogger,
  _fetchFn: FetchFn = globalThis.fetch,
): Promise<KeyStatus> {
  try {
    // Check key status from relay
    const resp = await _fetchFn(`${config.relayUrl}/v1/key/status`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    if (!resp.ok) {
      logger.warn(`[agentxp/key-manager] status check failed: ${resp.status}`)
      return { valid: false }
    }

    const data = (await resp.json()) as { valid: boolean; expiresAt?: number }

    if (!data.valid || (data.expiresAt && data.expiresAt < Date.now() + 7 * 24 * 60 * 60 * 1000)) {
      // Key expired or expiring within 7 days — attempt renewal
      logger.info('[agentxp/key-manager] key expiring soon, attempting renewal')

      const renewResp = await _fetchFn(`${config.relayUrl}/v1/key/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (renewResp.ok) {
        logger.info('[agentxp/key-manager] key renewed successfully')
        return { valid: true, expiresAt: data.expiresAt, renewed: true }
      } else {
        logger.error(`[agentxp/key-manager] renewal failed: ${renewResp.status}`)
        return { valid: false, expiresAt: data.expiresAt, renewed: false }
      }
    }

    logger.debug('[agentxp/key-manager] key is valid')
    return { valid: true, expiresAt: data.expiresAt }
  } catch (err) {
    logger.error(`[agentxp/key-manager] error: ${err}`)
    throw err
  }
}
