/**
 * memory-prompt.ts — MemoryPromptSectionBuilder for AgentXP v3
 * 
 * Implements §7.12 Proactive Recall + §5.2 Mid-task Checkpoint:
 * - First message: proactive recall (mistakes + lessons summaries)
 * - 5+ tool calls: mid-task checkpoint (inject + clear flag)
 * - Pending reflection prompts: inject + consume
 * - Else: selective injection via injection-engine (D')
 * 
 * Uses module-level "last active session" tracking since builder signature
 * doesn't include sessionKey. The message_sending hook will call
 * setLastActiveSession() to keep this fresh.
 */

import type { Db, ContextCache, ReflectionPrompt } from './db.js';
import { selectExperiences, inferPhase } from './injection-engine.js';
import { getLastActiveSession as getSharedSession } from './hooks/state.js';

// ─── OpenClaw Memory Prompt Type ───────────────────────────────────────────

export type MemoryPromptSectionBuilder = (params: {
  availableTools: Set<string>;
  citationsMode?: string;
}) => string[];

// ─── Module State ──────────────────────────────────────────────────────────

// 2026-04-17 fix: Previously this module kept its own _lastActiveSessionKey
// that was never written to by any hook (hooks used hooks/state.ts instead).
// Now we read directly from the shared state module. The timestamp tracking
// is removed because the shared state is always fresh when hooks fire.

/**
 * @deprecated Use hooks/state.ts setLastActiveSession instead.
 * Kept for backward compatibility / tests.
 */
export function setLastActiveSession(_sessionKey: string): void {
  // No-op: shared state is now authoritative. Hooks write to hooks/state.ts.
}

/**
 * @deprecated No-op retained for test compatibility.
 */
export function resetLastActiveSession(): void {
  // No-op.
}

// ─── Testing Overrides ─────────────────────────────────────────────────────

export let _nowFn: () => number = () => Date.now();

export function _setNowFn(fn: () => number): void {
  _nowFn = fn;
}

export function _resetNowFn(): void {
  _nowFn = () => Date.now();
}

// ─── Factory ───────────────────────────────────────────────────────────────

export interface PromptBuilderConfig {
  tokenBudget?: number;
  weaningRate?: number;
  _randomFn?: () => number;
}

export function createPromptBuilder(
  db: Db,
  config: PromptBuilderConfig = {},
): MemoryPromptSectionBuilder {
  const { tokenBudget = 500, weaningRate = 0.1, _randomFn } = config;

  return ({ availableTools, citationsMode }) => {
    // Guard 1: No active session → skip
    // Read from shared state (hooks/state.ts), which is set by
    // session-start and message-sending hooks.
    const sessionKey = getSharedSession();
    if (!sessionKey) {
      return [];
    }

    // Guard 2: Fetch context cache
    const cache = db.getContextCache.get(sessionKey) as ContextCache | undefined;
    if (!cache) {
      return [];
    }

    const keywords = cache.keywords ? JSON.parse(cache.keywords) : [];
    if (keywords.length === 0) {
      return [];
    }

    const lines: string[] = [];

    // Step 1: Check for pending reflection prompts → inject + consume
    const pendingPrompts = db.getUnconsumedPrompts.all(sessionKey) as ReflectionPrompt[];
    if (pendingPrompts.length > 0) {
      lines.push('## AgentXP Reflection Prompts');
      lines.push('');
      for (const prompt of pendingPrompts) {
        lines.push(prompt.prompt);
        lines.push('');
        db.markPromptConsumed.run(prompt.id);
      }
      
      // Record injection
      db.insertInjectionLog.run(
        sessionKey,
        1, // injected
        lines.join('\n').length / 4, // token_count
        JSON.stringify(pendingPrompts.map(p => p.id)), // source_ids
        'reflection', // source_type
        _nowFn() // created_at
      );

      return lines;
    }

    // Step 2: Mid-task checkpoint (5+ tool calls) → inject + clear flag
    if (cache.checkpoint_due === 1 && cache.tool_count >= 5) {
      lines.push('## AgentXP Mid-Task Checkpoint');
      lines.push('');
      lines.push('You have made 5+ tool calls. Pause and reflect:');
      lines.push('- Are you repeating the same mistakes?');
      lines.push('- Is there a relevant lesson you should apply?');
      lines.push('- Should you write a reflection before continuing?');
      lines.push('');

      // Run selective injection
      const query = keywords.join(' ');
      const result = selectExperiences({
        query,
        phase: inferPhase(query),
        db,
        tokenBudget,
        weaningRate,
        _randomFn,
      });

      if (result.injected) {
        lines.push('## Relevant Past Experiences');
        lines.push('');
        lines.push(...result.lines);
      }

      // Clear checkpoint flag
      db.db
        .prepare('UPDATE context_cache SET checkpoint_due = 0 WHERE session_id = ?')
        .run(sessionKey);

      // Record injection
      db.insertInjectionLog.run(
        sessionKey,
        1, // injected
        lines.join('\n').length / 4, // token_count
        JSON.stringify(result.sourceIds), // source_ids
        result.sourceType, // source_type
        _nowFn() // created_at
      );

      return lines;
    }

    // Step 3: First message → proactive recall (§7.12)
    if (cache.tool_count === 0) {
      lines.push('## AgentXP Proactive Recall');
      lines.push('');
      lines.push('Before starting this task, check your experience base:');
      lines.push('');

      // Search mistakes
      const mistakesQuery = keywords.join(' ');
      const mistakes = (db.searchReflectionsFts.all(mistakesQuery) as any[])
        .filter((r: any) => r.category === 'mistake')
        .slice(0, 3);

      if (mistakes.length > 0) {
        lines.push('### Relevant Mistakes');
        for (const m of mistakes) {
          const tags = m.tags ? JSON.parse(m.tags).join(', ') : '';
          lines.push(`- [mistake] ${m.title} — ${m.outcome} — ${tags}`);
        }
        lines.push('');
      }

      // Search lessons (from distilled)
      const lessons = (db.searchDistilledFts.all(mistakesQuery) as any[])
        .filter((d: any) => d.category === 'lesson')
        .slice(0, 3);

      if (lessons.length > 0) {
        lines.push('### Relevant Lessons');
        for (const l of lessons) {
          lines.push(`- [lesson] ${l.title} — ${l.summary} — applied ${l.applied_count}/success ${l.success_count}`);
        }
        lines.push('');
      }

      if (mistakes.length === 0 && lessons.length === 0) {
        lines.push('No directly relevant past experiences found.');
        lines.push('');
      }

      // Record injection
      const sourceIds = [...mistakes.map((m: any) => m.id), ...lessons.map((l: any) => l.id)];
      db.insertInjectionLog.run(
        sessionKey,
        1, // injected
        lines.join('\n').length / 4, // token_count
        JSON.stringify(sourceIds), // source_ids
        'reflection', // source_type
        _nowFn() // created_at
      );

      return lines;
    }

    // Step 4: Not first, not checkpoint → selective injection (D')
    const query = keywords.join(' ');
    const result = selectExperiences({
      query,
      phase: inferPhase(query),
      db,
      tokenBudget,
      weaningRate,
      _randomFn,
    });

    if (!result.injected) {
      return [];
    }

    lines.push('## AgentXP Experiences');
    lines.push('');
    lines.push(...result.lines);

    // Record injection
    db.insertInjectionLog.run(
      sessionKey,
      1, // injected
      result.tokenEstimate, // token_count
      JSON.stringify(result.sourceIds), // source_ids
      result.sourceType, // source_type
      _nowFn() // created_at
    );

    return lines;
  };
}
