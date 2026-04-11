/**
 * @serendip/protocol — Serendip Protocol 核心库
 *
 * 协议类型、密码学、Merkle 验证
 */

// Types
export * from './types.js'

// Crypto
export {
  generateOperatorKey,
  delegateAgentKey,
  revokeAgentKey,
} from './keys.js'

export {
  createEvent,
  signEvent,
  verifyEvent,
  canonicalize,
} from './events.js'

// Merkle
export {
  buildMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
} from './merkle.js'
