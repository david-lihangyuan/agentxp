// Public entry point for @agentxp/openclaw-plugin. Exports the three host
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
  onSessionStart,
  onBeforeToolCall,
  onAgentEnd,
  buildTrace,
  bucketize,
} from './hooks.js'
export type { MessageSendingSignal, SessionSummaryInput } from './hooks.js'

export {
  agentxpPlugin,
  createAgentxpPluginRegister,
  openDbFromConfig,
  AGENTXP_PLUGIN_ID,
  AGENTXP_PLUGIN_NAME,
  AGENTXP_PLUGIN_DESCRIPTION,
} from './adapter.js'
export type {
  AgentxpPublisherOptions,
  AgentxpRegisterHandle,
  AgentxpRegisterOptions,
} from './adapter.js'

export { AgentKeyLoadError, loadAgentKey } from './identity.js'

export { startPublishLoop } from './publish-loop.js'
export type { PublishLoopHandle, PublishLoopOptions } from './publish-loop.js'

export { resolvePluginConfig } from './config.js'
export type { ResolvedPluginConfig, Visibility } from './config.js'

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

export { inferPhase } from './phase.js'
export type { Phase, PhaseInput } from './phase.js'

export {
  setLastActiveSession,
  getLastActiveSession,
  getSessionState,
  pushToolName,
  pushKeywords,
  resetSessionState,
  MAX_TOOL_HISTORY,
  MAX_KEYWORD_HISTORY,
} from './session-state.js'
export type { SessionState } from './session-state.js'

export { createCorpusSupplement, searchStagedSync } from './memory-corpus.js'
export type {
  CorpusScope,
  CorpusSupplementOptions,
  SearchStagedOptions,
} from './memory-corpus.js'

export { createPromptBuilder } from './memory-prompt.js'
export type { PromptBuilderOptions } from './memory-prompt.js'
