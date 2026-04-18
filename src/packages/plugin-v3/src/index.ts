// Public entry point for @agentxp/plugin-v3. Exports the three host
// hook handlers (SPEC 03-modules-product §5.1), local staging, the
// SDK-retry publisher, and shared types.
export type {
  MessageSendingCtx,
  ToolCallCtx,
  SessionEndCtx,
  ToolCallDescriptor,
  ToolCallResult,
  PluginTraceStep,
  PluginReasoningTrace,
} from './types.js'

export {
  onMessageSending,
  onToolCall,
  onSessionEnd,
  buildTrace,
  bucketize,
} from './hooks.js'
export type { MessageSendingSignal, SessionSummaryInput } from './hooks.js'

export { openPluginDb } from './db.js'
export type {
  PluginDb,
  StagedTraceStep,
  StagedExperience,
} from './db.js'

export {
  sdkNextAttemptDelay,
  MAX_ATTEMPTS,
} from './backoff.js'
export type { SdkBackoffOptions } from './backoff.js'

export { publishStagedExperiences } from './publisher.js'
export type { PublishOptions, PublishResult } from './publisher.js'
