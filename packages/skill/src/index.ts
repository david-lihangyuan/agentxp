// @agentxp/skill — Public API
// AgentXP Reflection Skill: proactive recall, install, heartbeat, parsing,
// distillation, publishing, local search, local server, key renewal.

export { proactiveRecall } from './proactive-recall.js'
export type { RecallMatch } from './proactive-recall.js'

export { runInstall, generateIdentityKeys } from './install.js'
export type { InstallOptions } from './install.js'

export {
  writeHeartbeatChain,
  appendHeartbeatChain,
  extractOldestEntry,
  parseHeartbeatChain,
  compressEntry,
} from './heartbeat-chain.js'
export type { HeartbeatEntry } from './heartbeat-chain.js'

export { parseReflectionEntry, processReflectionFile } from './reflection-parser.js'
export type { ParsedReflection } from './reflection-parser.js'

export { distill, checkLLMTrigger } from './distiller.js'
export type { DistillResult } from './distiller.js'

export { distillExperiences } from './distill.js'
export type { ExperienceDistillResult, StrategyRule } from './distill.js'

export { createDraft, runBatchPublish, getNextRetryDelay, readDraftFile } from './publisher.js'
export type { DraftEntry, BatchPublishOptions, BatchPublishResult } from './publisher.js'

export { localSearch } from './local-search.js'
export type { SearchResultSummary, SearchOptions } from './local-search.js'

export { startLocalServer, validateRelayUrl } from './local-server.js'
export type { LocalServer, RelayUrlValidation } from './local-server.js'

export { checkAndRenew, renewKey } from './key-renewer.js'
export type { RenewalResult } from './key-renewer.js'

export { getStatus } from './cli.js'
export type { StatusResult } from './cli.js'

export { checkForUpdate } from './update-checker.js'
export type { UpdateCheckResult, UpdateMode } from './update-checker.js'

export { estimateTokens, bytesToHex } from './utils.js'

export { fetchFeedback, submitFeedback, getFeedbackSummary } from './feedback-client.js'
export type { FeedbackEvent, FeedbackSubmission, FeedbackSummary } from './feedback-client.js'

export type { ProactiveRecallOptions, ProactiveRecallResult, TaskPhase } from './proactive-recall.js'
export { inferPhase, phaseWeight } from './proactive-recall.js'

export { wrapExperiences, escapeHtml } from './context-wrapper.js'
export type { Experience } from './context-wrapper.js'

export { extractCodeBlocks, assessCodeRisk, sandboxWrap } from './sandbox.js'
export type { CodeBlock, RiskLevel, RiskAssessment } from './sandbox.js'

export { TraceRecorder } from './trace-recorder.js'
export type {
  TraceAction,
  StepSignificance,
  TraceStep,
  DeadEnd,
  TraceExport,
} from './trace-recorder.js'

export { publishWithTrace } from './trace-publisher.js'
export type { TracePublishOptions, TracePublishResult } from './trace-publisher.js'
