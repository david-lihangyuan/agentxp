// Serendip Protocol — Ed25519 Key Generation & Delegation
import { ed25519 } from '@noble/curves/ed25519'
import { randomBytes } from '@noble/hashes/utils'
import type { OperatorKey, AgentKey, SerendipEvent } from './types'
import { bytesToHex } from './utils'

/**
 * Generate a new Operator master key pair (Ed25519).
 * The operator key is the identity anchor — store it securely offline.
 */
export async function generateOperatorKey(): Promise<OperatorKey> {
  const privateKey = randomBytes(32)
  const publicKey = bytesToHex(ed25519.getPublicKey(privateKey))
  return { publicKey, privateKey }
}

/**
 * Delegate a new Agent sub-key from an Operator key.
 * The agent key has a TTL and carries the operator's public key for trust chain verification.
 *
 * In solo-developer mode: call this with the same key as both operator and result will have
 * delegatedBy = operator pubkey, which is valid.
 *
 * @param operatorKey - Operator master key authorizing this delegation
 * @param agentId - Human-readable agent identifier
 * @param ttlDays - Key validity period in days
 */
export async function delegateAgentKey(
  operatorKey: OperatorKey,
  agentId: string,
  ttlDays: number
): Promise<AgentKey> {
  const privateKey = randomBytes(32)
  const publicKey = bytesToHex(ed25519.getPublicKey(privateKey))
  const expiresAt = Math.floor(Date.now() / 1000) + ttlDays * 86400
  return {
    publicKey,
    privateKey,
    delegatedBy: operatorKey.publicKey,
    expiresAt,
    agentId,
  }
}

/**
 * Delegate an Agent sub-key. Produces a signed identity.delegate event.
 * The operator signs the delegation — relays use this to establish the trust chain.
 *
 * @param operatorKey - Operator master key authorizing the delegation
 * @param agentKey - The agent key being delegated
 */
export async function createDelegateEvent(
  operatorKey: OperatorKey,
  agentKey: AgentKey
): Promise<SerendipEvent> {
  // Import here to avoid circular dependency between keys.ts and events.ts
  const { createEvent, signEvent } = await import('./events')

  // The operator key acts as its own agent for signing this delegation
  const operatorAsAgent: AgentKey = {
    publicKey: operatorKey.publicKey,
    privateKey: operatorKey.privateKey,
    delegatedBy: operatorKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400, // operators don't expire
  }

  const payload = {
    type: 'identity.delegate',
    data: {
      agentPubkey: agentKey.publicKey,
      expiresAt: agentKey.expiresAt,
      agentId: agentKey.agentId,
      delegatedAt: Math.floor(Date.now() / 1000),
    },
  }

  const unsignedEvent = createEvent('identity.delegate', payload, [])
  return signEvent(unsignedEvent, operatorAsAgent)
}

/**
 * Revoke an Agent sub-key. Produces a signed identity.revoke event.
 * The operator signs the revocation — relays check operator signature to validate.
 *
 * @param operatorKey - Operator master key authorizing the revocation
 * @param agentPubkey - Public key of the agent to revoke (hex)
 */
export async function revokeAgentKey(
  operatorKey: OperatorKey,
  agentPubkey: string
): Promise<SerendipEvent> {
  // Import here to avoid circular dependency between keys.ts and events.ts
  const { createEvent, signEvent } = await import('./events')

  // The operator key acts as its own agent for signing this revocation
  const operatorAsAgent: AgentKey = {
    publicKey: operatorKey.publicKey,
    privateKey: operatorKey.privateKey,
    delegatedBy: operatorKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400, // operators don't expire
  }

  const payload = {
    type: 'identity.revoke',
    data: {
      revokedKey: agentPubkey,
      revokedAt: Math.floor(Date.now() / 1000),
    },
  }

  const unsignedEvent = createEvent('identity.revoke', payload, [])
  return signEvent(unsignedEvent, operatorAsAgent)
}
