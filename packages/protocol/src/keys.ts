// Ed25519 key generation and delegation.
// Ported from legacy/src-v1/packages/protocol/src/keys.ts:11-43.
import { ed25519 } from '@noble/curves/ed25519'
import { randomBytes } from '@noble/hashes/utils'
import type { AgentKey, OperatorKey } from './types.js'
import { bytesToHex } from './utils.js'

const SECONDS_PER_DAY = 86_400

/**
 * Generate a new operator master key pair. The operator key is the
 * identity anchor and is expected to be held offline by the human.
 */
export async function generateOperatorKey(): Promise<OperatorKey> {
  const privateKey = randomBytes(32)
  const publicKey = bytesToHex(ed25519.getPublicKey(privateKey))
  return { publicKey, privateKey }
}

/**
 * Delegate a new agent sub-key from an operator key. The returned
 * AgentKey carries `delegatedBy = operatorKey.publicKey` so relays can
 * establish the trust chain without additional ceremony.
 */
export async function delegateAgentKey(
  operatorKey: OperatorKey,
  agentId: string,
  ttlDays: number,
): Promise<AgentKey> {
  const privateKey = randomBytes(32)
  const publicKey = bytesToHex(ed25519.getPublicKey(privateKey))
  const expiresAt = Math.floor(Date.now() / 1000) + ttlDays * SECONDS_PER_DAY
  return {
    publicKey,
    privateKey,
    delegatedBy: operatorKey.publicKey,
    expiresAt,
    agentId,
  }
}
