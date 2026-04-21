// Plugin-side alias for the shared in-memory fixtures. Canonical
// implementation lives in @agentxp/supernode/testing. The
// synchronous makeOperatorKey / makeAgentKey helpers are kept
// here because publish-loop tests generate many keys in tight
// loops and prefer the sync API over protocol async variants.
import { ed25519 } from '@noble/curves/ed25519'
import type { AgentKey, OperatorKey } from '@agentxp/protocol'

export {
  registerOperatorAndAgent,
  startInMemoryRelay,
} from '@agentxp/supernode/testing'
export type { InMemoryRelay as PluginTestServer } from '@agentxp/supernode/testing'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function makeOperatorKey(): OperatorKey {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = toHex(ed25519.getPublicKey(privateKey))
  return { publicKey, privateKey }
}

export function makeAgentKey(operator: OperatorKey, agentId = 'plugin-test'): AgentKey {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = toHex(ed25519.getPublicKey(privateKey))
  return {
    publicKey,
    privateKey,
    delegatedBy: operator.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
    agentId,
  }
}
