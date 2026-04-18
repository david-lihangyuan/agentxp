/**
 * tool-call.ts — before_tool_call and after_tool_call hooks.
 *
 * before_tool_call: Records a trace step (significance = routine).
 * after_tool_call: Detects errors, records trace step with error signature,
 *                  increments tool count, sets checkpoint_due if >= 5 tool calls.
 * Never blocks tool calls.
 */

import type { Db } from '../db.js';
import { getLastActiveSession, setLastActiveSession } from './state.js';

export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
}

export interface AfterToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  runId?: string;
  toolCallId?: string;
}

export interface ToolCallContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  toolCallId?: string;
}

/**
 * Normalize a tool name into a human-readable action string.
 */
function normalizeAction(toolName: string): string {
  const map: Record<string, string> = {
    'read': 'file:read',
    'write': 'file:write',
    'edit': 'file:edit',
    'exec': 'shell:exec',
    'process': 'shell:process',
    'web_fetch': 'web:fetch',
    'memory_search': 'memory:search',
    'memory_get': 'memory:get'
  };
  
  return map[toolName] || `tool:${toolName}`;
}

/**
 * Extract error signature from error string or result.
 */
function extractErrorSignature(error?: string, result?: unknown): string | null {
  if (!error) return null;
  
  // Extract first line of error message
  const lines = error.split('\n');
  const firstLine = lines[0]?.trim();
  
  if (!firstLine) return 'unknown_error';
  
  // Common error patterns
  if (/ENOENT/.test(firstLine)) return 'ENOENT';
  if (/EACCES/.test(firstLine)) return 'EACCES';
  if (/ETIMEDOUT/.test(firstLine)) return 'ETIMEDOUT';
  if (/ECONNREFUSED/.test(firstLine)) return 'ECONNREFUSED';
  if (/SyntaxError/.test(firstLine)) return 'SyntaxError';
  if (/TypeError/.test(firstLine)) return 'TypeError';
  if (/ReferenceError/.test(firstLine)) return 'ReferenceError';
  
  // Return truncated first line (max 50 chars)
  return firstLine.slice(0, 50);
}

export function createBeforeToolCallHook(db: Db) {
  return (event: BeforeToolCallEvent, ctx: ToolCallContext): void => {
    const sessionId = ctx.sessionId || getLastActiveSession();
    if (!sessionId) return;
    
    // Keep shared state fresh (survives gateway restarts mid-session)
    setLastActiveSession(sessionId);
    
    const action = normalizeAction(event.toolName);
    const now = Date.now();
    
    (db.insertTraceStep as any).run(
      sessionId,
      action,
      event.toolName,
      'routine', // significance
      null,      // error_signature
      0,         // duration_ms (not known yet)
      now
    );
  };
}

export function createAfterToolCallHook(db: Db) {
  return (event: AfterToolCallEvent, ctx: ToolCallContext): void => {
    const sessionId = ctx.sessionId || getLastActiveSession();
    if (!sessionId) return;
    
    const hasError = !!event.error;
    const significance = hasError ? 'error' : 'routine';
    const errorSignature = hasError ? extractErrorSignature(event.error, event.result) : null;
    const action = normalizeAction(event.toolName);
    const now = Date.now();
    
    // Record trace step with error info
    (db.insertTraceStep as any).run(
      sessionId,
      action,
      event.toolName,
      significance,
      errorSignature,
      event.durationMs || 0,
      now
    );
    
    // Update context cache: increment tool count and check for checkpoint
    const cache = db.getContextCache.get(sessionId) as any;
    if (cache) {
      const newToolCount = cache.tool_count + 1;
      const checkpointDue = newToolCount >= 5 ? 1 : cache.checkpoint_due;
      
      (db.upsertContextCache as any).run(
        sessionId,
        cache.keywords,
        newToolCount,
        cache.first_message,
        checkpointDue,
        now
      );
    }
  };
}
