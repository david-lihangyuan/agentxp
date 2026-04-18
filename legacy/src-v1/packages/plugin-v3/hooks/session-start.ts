/**
 * session-start.ts — session_start hook.
 *
 * Initializes the context_cache for the session if it doesn't exist.
 * Sets lastActiveSession for cross-hook state coordination.
 * Does not overwrite existing cache (supports session resumption).
 */

import type { Db } from '../db.js';
import { setLastActiveSession } from './state.js';

export interface SessionStartEvent {
  sessionId: string;
  sessionKey?: string;
  resumedFrom?: string;
}

export interface SessionContext {
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
}

export function createSessionStartHook(db: Db) {
  return (event: SessionStartEvent, ctx: SessionContext): void => {
    const sessionId = event.sessionId || ctx.sessionId;
    
    // Set shared state
    setLastActiveSession(sessionId);
    
    // Check if cache already exists
    const existing = db.getContextCache.get(sessionId) as any;
    
    if (!existing) {
      // Initialize new cache
      const now = Date.now();
      (db.upsertContextCache as any).run(
        sessionId,
        JSON.stringify([]), // keywords
        0,                  // tool_count
        'true',            // first_message
        0,                 // checkpoint_due
        now                // updated_at
      );
    }
  };
}
