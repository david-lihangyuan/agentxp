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
  // L2 Reasoning Trace
  TraceAction,
  StepSignificance,
  TraceStep,
  DeadEnd,
  DifficultyAssessment,
  DomainFingerprint,
  Prerequisites,
  VersionContext,
  ReasoningTrace,
  TraceFeedback,
} from './types.js'

export {
  generateOperatorKey,
  delegateAgentKey,
  revokeAgentKey,
  createDelegateEvent,
} from './keys.js'

export {
  createEvent,
  signEvent,
  verifyEvent,
  canonicalize,
} from './events.js'

export {
  buildMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
} from './merkle.js'
