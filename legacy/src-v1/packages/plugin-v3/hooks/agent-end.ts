/**
 * agent-end.ts — agent_end hook (Forced Pause).
 *
 * Reads trace steps for the session, generates reflection prompt with the three
 * key questions (§5.2), and stores it in reflection_prompts table.
 * The prompt will be consumed at the start of the next session.
 */

import type { Db, TraceStep } from '../db.js';
import { getLastActiveSession } from './state.js';

export interface AgentEndEvent {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
}

export interface AgentEndContext {
  runId?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
}

export function createAgentEndHook(db: Db) {
  return (event: AgentEndEvent, ctx: AgentEndContext): void => {
    const sessionId = ctx.sessionId || getLastActiveSession();
    if (!sessionId) return;
    
    // Get trace steps for this session
    const steps = db.getTraceStepsBySession.all(sessionId) as TraceStep[];
    
    // No activity = no reflection needed
    if (steps.length === 0) return;
    
    // Count tools and errors
    const toolCount = steps.length;
    const errorSteps = steps.filter(s => s.significance === 'error');
    const errorCount = errorSteps.length;
    
    // Extract unique error signatures
    const errorSignatures = Array.from(
      new Set(errorSteps.map(s => s.error_signature).filter(Boolean))
    );
    
    // Build reflection prompt with §5.2 questions + §5.4 structured format.
    // The structured format is critical: message-sending hook parses it via
    // extraction.ts to persist reflections into the DB. Without this format,
    // reflections are lost (discovered 2026-04-17 during end-to-end testing).
    let prompt = `At the end of this session, please reflect on what happened.

Write each reflection as a structured block in your reply (not to files). Use this exact format:

## [Short title describing what happened]
- Tried: [What you attempted]
- Expected: [What you expected to happen]
- Outcome: failed | succeeded | partial
- Learned: [Key takeaway — one sentence]
- Why I was wrong: [Only if outcome=failed — why your assumption was wrong]
- Tags: [comma-separated: mistake, lesson, feeling, thought, plus domain tags]

Reflect on these three questions:
1. What went wrong? Why did you think you were right at the time?
2. What worked? What's the reusable pattern?
3. What surprised you? What contradicts your prior assumptions?

Write one block per distinct insight. Skip questions that don't apply.

---

**Session Summary:**
- Tool calls: ${toolCount}
- Errors: ${errorCount}`;
    
    if (errorSignatures.length > 0) {
      prompt += `\n- Error signatures: ${errorSignatures.join(', ')}`;
    }
    
    // Store prompt for next session
    const now = Date.now();
    (db.insertReflectionPrompt as any).run(
      sessionId,
      prompt,
      0, // consumed = false
      now
    );
  };
}
