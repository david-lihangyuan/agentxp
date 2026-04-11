// @serendip/protocol — Public API
// Serendip Protocol core: types, keys, events, Merkle integrity

export type {
  SerendipEvent,
  IntentKind,
  IdentityKind,
  SerendipKind,
  IntentPayload,
  ExperiencePayload,
  ExperienceData,
  ExperienceScope,
  OperatorKey,
  AgentKey,
} from './types'

export {
  generateOperatorKey,
  delegateAgentKey,
  revokeAgentKey,
  createDelegateEvent,
} from './keys'

export {
  createEvent,
  signEvent,
  verifyEvent,
  canonicalize,
} from './events'

export {
  buildMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
} from './merkle'
