/**
 * state.ts — Shared state across hooks.
 *
 * Tracks the last active session ID so that hooks can coordinate.
 * Used by session-start, message-sending, and tool-call hooks.
 */

export let lastActiveSession: string | null = null;

export function setLastActiveSession(sessionId: string): void {
  lastActiveSession = sessionId;
}

export function getLastActiveSession(): string | null {
  return lastActiveSession;
}
