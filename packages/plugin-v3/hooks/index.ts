/**
 * hooks/index.ts — Export all OpenClaw lifecycle hooks.
 *
 * Phase 3 implementation:
 * - session-start: Initialize context cache
 * - message-sending: Extract keywords + parse reflections
 * - before-tool-call: Record trace step (routine)
 * - after-tool-call: Detect errors, increment tool count, set checkpoint
 * - agent-end: Generate reflection prompts (§5.2 three questions)
 * - session-end: Cleanup
 */

export { createSessionStartHook } from './session-start.js';
export { createSessionEndHook } from './session-end.js';
export { createMessageSendingHook } from './message-sending.js';
export { createBeforeToolCallHook, createAfterToolCallHook } from './tool-call.js';
export { createAgentEndHook } from './agent-end.js';
export { getLastActiveSession, setLastActiveSession } from './state.js';

export type {
  SessionStartEvent,
  SessionContext
} from './session-start.js';

export type {
  SessionEndEvent
} from './session-end.js';

export type {
  MessageSendingEvent,
  MessageSendingContext
} from './message-sending.js';

export type {
  BeforeToolCallEvent,
  AfterToolCallEvent,
  ToolCallContext
} from './tool-call.js';

export type {
  AgentEndEvent,
  AgentEndContext
} from './agent-end.js';
