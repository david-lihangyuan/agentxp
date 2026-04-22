// @agentxp/skill public API (used primarily by tests and by the CLI).
export { initWorkspace } from './init.js'
export type { InitOptions, InitResult } from './init.js'
export {
  captureInSessionDraft,
  captureEndOfSessionDraft,
  openStoreForTarget,
  reflect,
  DraftValidationError,
} from './reflect.js'
export type { DraftInput, ReflectOptions, ReflectOutcome, SkillConfig } from './reflect.js'
export { openDraftStore } from './drafts.js'
export type { DraftRow, DraftStore, ReflectionTier } from './drafts.js'
export {
  ensureOperatorKey,
  loadOperatorKey,
  ensureAgentKey,
  resolveIdentityPaths,
  OperatorKeyMissingError,
} from './identity.js'
export { publishDrafts } from './publisher.js'
export type { PublishOptions, PublishResult } from './publisher.js'
export { nextAttemptDelay } from './backoff.js'
export { runCli } from './cli.js'
