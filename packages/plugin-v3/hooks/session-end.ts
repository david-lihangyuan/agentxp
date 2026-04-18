/**
 * session-end.ts — session_end hook.
 *
 * Cleans up context_cache for the session when it ends.
 * This ensures stale cache doesn't persist across disconnected sessions.
 */

import type { Db } from '../db.js';

export interface SessionEndEvent {
  sessionId: string;
  sessionKey?: string;
  messageCount?: number;
  durationMs?: number;
  reason?: string;
}

export interface SessionContext {
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
}

export function createSessionEndHook(db: Db) {
  return (_event: SessionEndEvent, ctx: SessionContext): void => {
    const sessionId = ctx.sessionId;
    if (!sessionId) return;
    
    // Delete context cache for this session
    // Note: Using raw SQL since we don't have a prepared delete statement
    db.db.prepare('DELETE FROM context_cache WHERE session_id = ?').run(sessionId);
  };
}
