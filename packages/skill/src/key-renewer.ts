// Sub-key Auto-renewer — Check agent sub-key expiry, auto-renew when < 14 days remaining
// Silent background task — user never sees key management.

import type { AgentKey, OperatorKey, SerendipEvent } from '@serendip/protocol'
import { delegateAgentKey, createDelegateEvent } from '@serendip/protocol'

/** Renewal threshold: 14 days in seconds */
const RENEWAL_THRESHOLD_SECONDS = 14 * 86400

/** New key TTL: 90 days */
const NEW_KEY_TTL_DAYS = 90

export interface RenewalResult {
  /** Whether the key was renewed */
  renewed: boolean
  /** The new agent key (if renewed) */
  newKey?: AgentKey
  /** The delegation event (if renewed) */
  delegateEvent?: SerendipEvent
  /** Days remaining until expiry (0 if expired) */
  daysRemaining?: number
}

/**
 * Check if a key's expiry time is within the renewal threshold.
 * Returns true if the key should be renewed (< 14 days remaining or already expired).
 *
 * @param expiresAt - Unix timestamp (seconds) when the key expires
 */
export function shouldRenew(expiresAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  const remaining = expiresAt - now
  return remaining < RENEWAL_THRESHOLD_SECONDS
}

/**
 * Check an agent key and renew it if expiry is within 14 days.
 * Produces a new AgentKey + signed delegation event.
 * This is a silent operation — no user prompt or confirmation needed.
 *
 * @param agentKey - Current agent sub-key to check
 * @param operatorKey - Operator master key for signing the new delegation
 */
/**
 * Compute days remaining until expiry, clamped to 0 for expired keys.
 */
function computeDaysRemaining(expiresAt: number): number {
  const now = Math.floor(Date.now() / 1000)
  const remaining = expiresAt - now
  return remaining <= 0 ? 0 : Math.floor(remaining / 86400)
}

export async function checkAndRenew(
  agentKey: AgentKey,
  operatorKey: OperatorKey
): Promise<RenewalResult> {
  const daysRemaining = computeDaysRemaining(agentKey.expiresAt)

  if (!shouldRenew(agentKey.expiresAt)) {
    return { renewed: false, daysRemaining }
  }

  // Generate a new agent sub-key with 90-day TTL
  const newKey = await delegateAgentKey(
    operatorKey,
    agentKey.agentId || 'agent',
    NEW_KEY_TTL_DAYS
  )

  // Create signed delegation event
  const delegateEvent = await createDelegateEvent(operatorKey, newKey)

  return {
    renewed: true,
    newKey,
    delegateEvent,
    daysRemaining,
  }
}

/**
 * Renew an agent key directly. Returns the new AgentKey with 90-day TTL.
 * The new key inherits the agentId from the original key.
 *
 * @param agentKey - Current agent sub-key to renew
 * @param operatorKey - Operator master key for signing the new delegation
 */
export async function renewKey(
  agentKey: AgentKey,
  operatorKey: OperatorKey
): Promise<AgentKey> {
  return delegateAgentKey(
    operatorKey,
    agentKey.agentId || 'agent',
    NEW_KEY_TTL_DAYS
  )
}
