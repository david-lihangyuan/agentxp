/**
 * hooks/index.ts — Re-export all hook factories and shared state.
 */

export { createMessageSendingHook, extractKeywords } from './message-sending.js'
export type { MessageSendingEvent, MessageSendingContext } from './message-sending.js'

export { createAfterToolCallHook } from './after-tool-call.js'
export type { AfterToolCallEvent, ToolCallContext } from './after-tool-call.js'

export { createAgentEndHook } from './agent-end.js'
export type { AgentEndEvent, AgentEndContext } from './agent-end.js'

export { createBeforeToolCallHook, normalizeAction } from './before-tool-call.js'
export type { BeforeToolCallEvent, BeforeToolCallContext } from './before-tool-call.js'

export { createSessionStartHook, createSessionEndHook } from './session-lifecycle.js'
export type { SessionStartEvent, SessionEndEvent, SessionContext } from './session-lifecycle.js'

export {
  toolCallBuffers,
  getToolCallBuffer,
  setLastActiveSession,
  getLastActiveSession,
  resetState,
} from './state.js'
