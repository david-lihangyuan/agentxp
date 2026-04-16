/**
 * injection-engine.ts — D' Selective Injection Engine for AgentXP.
 *
 * Selects relevant past experiences and injects them into agent prompts.
 * Features: phase-aware weighting, token budgeting, weaning mechanism,
 * SSRF-safe relay URL validation, and secure context wrapping.
 */

import type { Db, Lesson } from './db.js'
import type { PluginConfig } from './types.js'
import { wrapLessons } from './context-wrapper.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export type Phase = 'planning' | 'executing' | 'stuck' | 'evaluating'

export interface InjectionResult {
  injected: boolean
  lines: string[]
  tokenEstimate: number
  lessonIds: number[]
  skippedByWeaning: boolean
}

export interface SelectExperiencesParams {
  keywords: string[]
  phase?: Phase
  db: Db
  config: PluginConfig
  /** Override Math.random for testing */
  _randomFn?: () => number
}

// ─── Phase Inference ───────────────────────────────────────────────────────

/**
 * Infer the agent's current phase from keywords.
 * Used when caller doesn't explicitly set a phase.
 */
export function inferPhase(keywords: string[]): Phase {
  const text = keywords.join(' ').toLowerCase()
  if (/error|fail|stuck|debug|why|broken/.test(text)) return 'stuck'
  if (/plan|design|architect|think|decide/.test(text)) return 'planning'
  if (/test|verify|check|assert|confirm/.test(text)) return 'evaluating'
  return 'executing'
}

// ─── SSRF Protection ───────────────────────────────────────────────────────

/**
 * Validate that a relay URL is safe to fetch.
 * Must be HTTPS and must not point to private/reserved IPs.
 */
export function validateRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false

    const host = parsed.hostname
    // localhost
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return false
    // 10.x.x.x
    if (/^10\./.test(host)) return false
    // 172.16-31.x.x
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
    // 192.168.x.x
    if (/^192\.168\./.test(host)) return false
    // link-local / AWS metadata
    if (host.startsWith('169.254.')) return false
    // 0.0.0.0
    if (host === '0.0.0.0') return false

    return true
  } catch {
    return false
  }
}

// ─── Token Estimation ──────────────────────────────────────────────────────

/**
 * Rough token estimate: ~4 chars per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ─── Phase-Aware Relevance Weighting ───────────────────────────────────────

/** Phase keyword patterns for boosting relevance */
const PHASE_PATTERNS: Record<Phase, RegExp> = {
  planning: /strategy|design|architecture|approach|plan|pattern|decision/i,
  executing: /how to|step|implement|code|function|method|api|build/i,
  stuck: /error|fail|bug|fix|workaround|backtrack|dead.?end|debug|retry/i,
  evaluating: /test|verify|assert|confirm|check|validate|outcome|result/i,
}

/**
 * Score a lesson's relevance for the current phase.
 * Returns a score between 0 and 1. Combines:
 * - Base score from DB (relevanceScore, normalized by appliedCount/successCount)
 * - Phase-match bonus
 */
export function scoreLessonForPhase(lesson: Lesson, phase: Phase): number {
  // Base: start at 0.5
  let score = 0.5

  // DB relevance score boost (0..1 range already)
  if (lesson.relevanceScore != null && lesson.relevanceScore > 0) {
    score += lesson.relevanceScore * 0.2
  }

  // Success rate boost (if applied at least once)
  if (lesson.appliedCount != null && lesson.appliedCount > 0) {
    const successRate = (lesson.successCount ?? 0) / lesson.appliedCount
    score += successRate * 0.15
  }

  // Phase-match bonus: search in all text fields
  const lessonText = `${lesson.what} ${lesson.tried} ${lesson.outcome} ${lesson.learned}`
  const pattern = PHASE_PATTERNS[phase]
  if (pattern.test(lessonText)) {
    score += 0.25
  }

  return Math.min(score, 1.0)
}

// ─── Main Selection Function ───────────────────────────────────────────────

const EMPTY_RESULT: InjectionResult = {
  injected: false,
  lines: [],
  tokenEstimate: 0,
  lessonIds: [],
  skippedByWeaning: false,
}

/**
 * Select experiences to inject into the agent's prompt.
 *
 * Steps:
 * 1. Weaning check (probabilistic skip)
 * 2. Local DB search via FTS5
 * 3. Phase-aware relevance scoring
 * 4. Relevance filter (score > 0.7)
 * 5. Greedy token-budget selection
 * 6. Context wrapping with security headers
 */
export function selectExperiences(params: SelectExperiencesParams): InjectionResult {
  const { keywords, db, config, _randomFn } = params
  const randomFn = _randomFn ?? Math.random

  // No keywords → no injection
  if (!keywords.length || keywords.every(k => !k.trim())) {
    return { ...EMPTY_RESULT }
  }

  // Step 1: Weaning check
  if (config.weaning.enabled && randomFn() < config.weaning.rate) {
    return { ...EMPTY_RESULT, skippedByWeaning: true }
  }

  // Step 2: Infer phase if not provided
  const phase = params.phase ?? inferPhase(keywords)

  // Step 3: Local search
  const query = keywords.join(' ')
  const localLessons = db.searchLessons(query, 10)

  if (localLessons.length === 0) {
    return { ...EMPTY_RESULT }
  }

  // Step 4: Phase-aware scoring + filter
  const scored = localLessons
    .map(lesson => ({
      lesson,
      score: scoreLessonForPhase(lesson, phase),
    }))
    .filter(item => item.score > 0.7)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return { ...EMPTY_RESULT }
  }

  // Step 5: Greedy token-budget selection
  const maxTokens = config.maxInjectionTokens
  const selected: Lesson[] = []
  let totalTokens = 0

  for (const { lesson } of scored) {
    const lessonText = `${lesson.what} ${lesson.tried} ${lesson.outcome} ${lesson.learned}`
    const tokenCost = estimateTokens(lessonText)

    if (totalTokens + tokenCost <= maxTokens) {
      selected.push(lesson)
      totalTokens += tokenCost
    }
  }

  if (selected.length === 0) {
    return { ...EMPTY_RESULT }
  }

  // Step 6: Wrap with context-wrapper
  const wrapped = wrapLessons(selected)
  const lines = wrapped.split('\n')

  return {
    injected: true,
    lines,
    tokenEstimate: estimateTokens(wrapped),
    lessonIds: selected.map(l => l.id!),
    skippedByWeaning: false,
  }
}
