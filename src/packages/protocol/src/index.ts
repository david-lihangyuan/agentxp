// @serendip/protocol — Public API.
// Per docs/spec/03-modules-platform.md §1 and ADR-003.

export type {
  AgentKey,
  DelegationPayload,
  ExperienceData,
  ExperiencePayload,
  ExperienceScope,
  IdentityKind,
  IntentKind,
  IntentPayload,
  OperatorKey,
  OperatorRegistrationPayload,
  RevocationPayload,
  SerendipEvent,
  SerendipKind,
} from './types.js'

export { canonicalize, sha256hex } from './canonical.js'
export { bytesToHex, hexToBytes } from './utils.js'
export { generateOperatorKey, delegateAgentKey } from './keys.js'
export { createEvent, signEvent, verifyEvent, MAX_PAYLOAD_BYTES } from './events.js'
export { loadKindRegistry } from './kinds.js'
export type { KindRegistryEntry, KindStatus } from './kinds.js'
export {
  InvalidKindError,
  InvalidKindRegistryError,
  PayloadTooLargeError,
} from './errors.js'
