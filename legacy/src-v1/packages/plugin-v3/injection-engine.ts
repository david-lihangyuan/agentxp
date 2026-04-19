/**
 * injection-engine.ts — Phase-aware experience injection for AgentXP v3
 * 
 * Implements §5.7 Token Value Principles:
 * - Stage-aware selection (stuck → mistakes first, planning → lessons first)
 * - Token budgeting (~500 token default, ~4 chars/token)
 * - 10% weaning (random skip for testing agent performance)
 * - Summary-first format (~20 token/entry)
 */

import type { Db, Reflection, Distilled } from './db.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export type Phase = 'stuck' | 'evaluating' | 'planning' | 'executing';

export interface InjectionResult {
  injected: boolean;
  lines: string[];
  tokenEstimate: number;
  sourceIds: number[];
  sourceType: 'reflection' | 'distilled';
  skippedByWeaning: boolean;
}

export interface SelectParams {
  query: string;
  phase?: Phase;
  db: Db;
  tokenBudget?: number;
  weaningRate?: number;
  _randomFn?: () => number;
}

// ─── Phase Inference ───────────────────────────────────────────────────────

/**
 * Infer agent phase from query text.
 * Priority: stuck > evaluating > planning > executing (default)
 */
export function inferPhase(query: string): Phase {
  const text = query.toLowerCase();
  if (/error|fail|stuck|debug|broken|why\s+wrong/.test(text)) return 'stuck';
  if (/test|verify|check|assert|confirm|outcome/.test(text)) return 'evaluating';
  if (/plan|design|architect|decide|strategy/.test(text)) return 'planning';
  return 'executing';
}

// ─── Token Estimation ──────────────────────────────────────────────────────

/**
 * Rough token estimate: ~4 chars per token
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Summary Formatting ────────────────────────────────────────────────────

/**
 * Format reflection as one-line summary (~20 tokens)
 * Format: - [category] title — outcome — tags
 */
function formatReflectionSummary(r: Reflection): string {
  const tags = r.tags ? JSON.parse(r.tags).join(', ') : '';
  return `- [${r.category}] ${r.title} — ${r.outcome} — ${tags}`;
}

/**
 * Format distilled entry as one-line summary
 * Format: - [category] title — summary — applied N/success M
 */
function formatDistilledSummary(d: Distilled): string {
  return `- [${d.category}] ${d.title} — ${d.summary} — applied ${d.applied_count}/success ${d.success_count}`;
}

// ─── Main Selection Function ───────────────────────────────────────────────

const EMPTY_RESULT: InjectionResult = {
  injected: false,
  lines: [],
  tokenEstimate: 0,
  sourceIds: [],
  sourceType: 'reflection',
  skippedByWeaning: false,
};

/**
 * Select experiences to inject based on phase-aware strategy.
 * 
 * Algorithm:
 * 1. Weaning check (probabilistic skip for testing)
 * 2. Infer phase if not provided
 * 3. Phase-aware search:
 *    - stuck: mistakes from reflections, cap 3
 *    - evaluating: stable sort (distilled > reflections)
 *    - planning: lessons from distilled, cap 5
 *    - executing: lessons from distilled, cap 2
 * 4. Token-budget greedy selection
 * 5. Return summary lines
 */
export function selectExperiences(params: SelectParams): InjectionResult {
  const {
    query,
    db,
    tokenBudget = 500,
    weaningRate = 0.1,
    _randomFn = Math.random,
  } = params;

  if (!query.trim()) {
    return { ...EMPTY_RESULT };
  }

  // Step 1: Weaning check
  if (_randomFn() < weaningRate) {
    return { ...EMPTY_RESULT, skippedByWeaning: true };
  }

  // Step 2: Infer phase
  const phase = params.phase ?? inferPhase(query);

  // Step 3: Phase-aware search
  let candidates: Array<{ text: string; id: number; type: 'reflection' | 'distilled' }> = [];

  if (phase === 'stuck') {
    // Search reflections, mistakes first
    const reflections = db.searchReflectionsFts.all(query) as Reflection[];
    const mistakes = reflections.filter(r => r.category === 'mistake').slice(0, 3);
    candidates = mistakes.map(r => ({
      text: formatReflectionSummary(r),
      id: r.id,
      type: 'reflection' as const,
    }));
  } else if (phase === 'evaluating') {
    // Stable sort: distilled > reflections
    const distilled = db.searchDistilledFts.all(query) as Distilled[];
    const reflections = db.searchReflectionsFts.all(query) as Reflection[];
    
    candidates = [
      ...distilled.map(d => ({
        text: formatDistilledSummary(d),
        id: d.id,
        type: 'distilled' as const,
      })),
      ...reflections.map(r => ({
        text: formatReflectionSummary(r),
        id: r.id,
        type: 'reflection' as const,
      })),
    ];
  } else if (phase === 'planning') {
    // Lessons from distilled, cap 5
    const distilled = db.searchDistilledFts.all(query) as Distilled[];
    const lessons = distilled.filter(d => d.category === 'lesson').slice(0, 5);
    candidates = lessons.map(d => ({
      text: formatDistilledSummary(d),
      id: d.id,
      type: 'distilled' as const,
    }));
  } else {
    // executing: lessons from distilled, cap 2
    const distilled = db.searchDistilledFts.all(query) as Distilled[];
    const lessons = distilled.filter(d => d.category === 'lesson').slice(0, 2);
    candidates = lessons.map(d => ({
      text: formatDistilledSummary(d),
      id: d.id,
      type: 'distilled' as const,
    }));
  }

  if (candidates.length === 0) {
    return { ...EMPTY_RESULT };
  }

  // Step 4: Token-budget greedy selection
  const selected: typeof candidates = [];
  let totalTokens = 0;

  for (const candidate of candidates) {
    const cost = estimateTokens(candidate.text);
    if (totalTokens + cost <= tokenBudget) {
      selected.push(candidate);
      totalTokens += cost;
    }
  }

  if (selected.length === 0) {
    return { ...EMPTY_RESULT };
  }

  // Step 5: Format output
  const lines = selected.map(c => c.text);
  const sourceIds = selected.map(c => c.id);
  const sourceType = selected[0].type; // All same type in current impl

  return {
    injected: true,
    lines,
    tokenEstimate: totalTokens,
    sourceIds,
    sourceType,
    skippedByWeaning: false,
  };
}
