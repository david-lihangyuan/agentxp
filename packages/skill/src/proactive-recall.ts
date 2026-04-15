// Proactive Recall — Pattern-match current task against local reflection files
// Runs at task-start hook, surfaces relevant past mistakes/lessons before execution.
// Optionally searches the relay for external experiences from the network.
// Supports phase-aware retrieval: adjusts result priority based on task phase.

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { relayRecall } from './relay-recall.js'
import type { RecallResult } from './relay-recall.js'

export interface RecallMatch {
  file: string
  content: string
  title: string
  score: number
}

// ---------------------------------------------------------------------------
// Phase inference
// ---------------------------------------------------------------------------

export type TaskPhase = 'planning' | 'stuck' | 'evaluating' | 'executing'

/**
 * Infer the current task phase from a task description string.
 * - planning:   plan, design, architect, how to
 * - stuck:      fix, debug, error, broken, failing
 * - evaluating: review, check, verify, test
 * - executing:  (default)
 */
export function inferPhase(taskDescription: string): TaskPhase {
  const lower = taskDescription.toLowerCase()

  if (/\bplan\b|\bdesign\b|\barchitect\b|\bhow to\b/.test(lower)) return 'planning'
  if (/\bfix\b|\bdebug\b|\berror\b|\bbroken\b|\bfailing\b/.test(lower)) return 'stuck'
  if (/\breview\b|\bcheck\b|\bverify\b|\btest\b/.test(lower)) return 'evaluating'
  return 'executing'
}

/**
 * Return a phase weight multiplier for a recall match.
 * Weights are used to bias sorting toward the most useful source for the phase.
 *
 * File weights:
 * - lessons.md with [auto-distilled] marker → "distilled strategy"
 * - lessons.md without marker               → "manual lesson"
 * - mistakes.md                             → "concrete case"
 *
 * Phase priorities:
 * - planning:   distilled strategy > manual lesson > concrete case
 * - executing:  distilled strategy ≈ manual lesson > concrete case (same weight as planning)
 * - stuck:      concrete case > distilled strategy > manual lesson
 * - evaluating: distilled strategy only (concrete cases deprioritized heavily)
 */
export function phaseWeight(match: RecallMatch, phase: TaskPhase): number {
  const isDistilled = match.content.includes('[auto-distilled]') ||
    match.title.includes('[auto-distilled]')
  const isLessons = match.file === 'lessons.md'
  const isMistakes = match.file === 'mistakes.md'

  switch (phase) {
    case 'planning':
      if (isLessons && isDistilled) return 2.0
      if (isLessons) return 1.5
      if (isMistakes) return 1.0
      return 1.0

    case 'executing':
      if (isLessons && isDistilled) return 2.0
      if (isLessons) return 1.5
      if (isMistakes) return 1.0
      return 1.0

    case 'stuck':
      if (isMistakes) return 2.0
      if (isLessons && isDistilled) return 1.5
      if (isLessons) return 1.2
      return 1.0

    case 'evaluating':
      // Only surface auto-distilled strategies
      if (isLessons && isDistilled) return 2.0
      if (isLessons) return 0.5
      if (isMistakes) return 0.1
      return 0.1
  }
}

// ---------------------------------------------------------------------------
// Confidence reinforcement
// ---------------------------------------------------------------------------

/**
 * Update TimesApplied and LastReinforced for auto-distilled entries that were
 * returned in a recall result.
 *
 * Reads lessons.md → finds matching [auto-distilled] sections → updates counters → writes back.
 */
function reinforceDistilledStrategies(matches: RecallMatch[], lessonsPath: string): void {
  if (!existsSync(lessonsPath)) return

  // Collect pattern ids from returned distilled matches
  const toReinforce = new Set<string>()
  for (const match of matches) {
    const isDistilled = match.content.includes('[auto-distilled]') ||
      match.title.includes('[auto-distilled]')
    if (!isDistilled || match.file !== 'lessons.md') continue

    // Extract pattern id from content
    const patternMatch = match.content.match(/^[-\s]*Pattern:\s*(.+)$/im)
    if (patternMatch) {
      toReinforce.add(patternMatch[1].trim())
    }
  }

  if (toReinforce.size === 0) return

  const content = readFileSync(lessonsPath, 'utf8')
  const today = new Date().toISOString().slice(0, 10)

  // Section-aware update: split on '## ' boundaries
  const parts = content.split(/(?=^## )/m)
  const updatedParts = parts.map(part => {
    if (!part.includes('[auto-distilled]')) return part

    // Find which pattern this section belongs to
    const patternMatch = part.match(/^[-\s]*Pattern:\s*(.+)$/im)
    if (!patternMatch) return part
    const sectionPattern = patternMatch[1].trim()

    if (!toReinforce.has(sectionPattern)) return part

    // Increment TimesApplied
    let updated = part.replace(
      /^([-\s]*TimesApplied:\s*)(\d+)/im,
      (_, label, num) => `${label}${parseInt(num, 10) + 1}`
    )

    // Update LastReinforced
    updated = updated.replace(
      /^([-\s]*LastReinforced:\s*)[^\n]+/im,
      `$1${today}`
    )

    return updated
  })

  writeFileSync(lessonsPath, updatedParts.join(''), 'utf8')
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

/**
 * Extract keywords from a task description.
 * Removes common stop words and returns unique lowercase tokens.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each',
    'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
    'than', 'too', 'very', 'just', 'about', 'up', 'out', 'it', 'its',
    'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our',
    'you', 'your', 'he', 'him', 'she', 'her', 'they', 'them', 'their',
    'what', 'which', 'who', 'when', 'where', 'why', 'how', 'if', 'then',
    'write', 'poem', 'make', 'get', 'let', 'also',
  ])

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
}

// ---------------------------------------------------------------------------
// Entry parsing and scoring
// ---------------------------------------------------------------------------

/**
 * Parse a reflection file into individual entries.
 * Each entry starts with ## heading.
 */
function parseEntries(content: string, fileName: string): Array<{ title: string; content: string; file: string }> {
  const entries: Array<{ title: string; content: string; file: string }> = []
  const sections = content.split(/^## /m).filter(s => s.trim())

  for (const section of sections) {
    const lines = section.split('\n')
    const title = lines[0]?.trim() || ''
    const body = lines.slice(1).join('\n').trim()
    if (title && body) {
      entries.push({ title, content: body, file: fileName })
    }
  }

  return entries
}

/**
 * Score an entry against a set of keywords.
 * Returns a score based on keyword matches in the entry text.
 */
function scoreEntry(entry: { title: string; content: string }, keywords: string[]): number {
  const text = `${entry.title} ${entry.content}`.toLowerCase()
  let score = 0
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      score += 1
      // Bonus for title match
      if (entry.title.toLowerCase().includes(keyword)) {
        score += 0.5
      }
    }
  }
  return score
}

// ---------------------------------------------------------------------------
// Options / result types
// ---------------------------------------------------------------------------

export interface ProactiveRecallOptions {
  /** Path to the reflection/ directory */
  reflectionDir?: string
  /** Relay URL — if provided, also searches the relay for external experiences */
  relayUrl?: string
  /** Agent home directory for loading operator pubkey (to exclude own experiences) */
  agentHomeDir?: string
  /**
   * Override the task phase used for result weighting.
   * If omitted, phase is inferred from taskDescription.
   */
  phase?: TaskPhase
}

export interface ProactiveRecallResult {
  /** Local matches from reflection files */
  local: RecallMatch[]
  /** Formatted relay results (wrapped in <external_experience> tags), or null if relay not used */
  relay: string | null
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Proactive recall: search local reflection files for entries matching a task description.
 * Returns matching entries sorted by relevance score × phase weight (highest first).
 * Optionally also searches the relay for external experiences.
 *
 * When phase-aware mode is active:
 * - planning / executing: prefer lessons.md auto-distilled strategies
 * - stuck: prefer mistakes.md concrete cases
 * - evaluating: only return auto-distilled strategies
 *
 * Distilled strategies that are returned have their TimesApplied and LastReinforced
 * fields updated in lessons.md automatically.
 *
 * @param taskDescription - What the agent is about to do
 * @param options - Reflection dir, relay URL, phase override, etc.
 *                  (string for backward compat = reflectionDir)
 */
export async function proactiveRecall(
  taskDescription: string,
  options?: string | ProactiveRecallOptions
): Promise<RecallMatch[]>
export async function proactiveRecall(
  taskDescription: string,
  options?: string | ProactiveRecallOptions
): Promise<RecallMatch[] | ProactiveRecallResult> {
  // Support both old (string) and new (options object) signatures
  const opts: ProactiveRecallOptions = typeof options === 'string'
    ? { reflectionDir: options }
    : options ?? {}

  const dir = opts.reflectionDir || join(process.cwd(), 'reflection')
  const keywords = extractKeywords(taskDescription)

  if (keywords.length === 0) {
    return typeof options === 'object' && options?.relayUrl
      ? { local: [], relay: null } as any
      : []
  }

  // Infer or use provided phase
  const phase: TaskPhase = opts.phase ?? inferPhase(taskDescription)

  const files = ['mistakes.md', 'lessons.md']
  const allMatches: RecallMatch[] = []

  for (const file of files) {
    const filePath = join(dir, file)
    if (!existsSync(filePath)) continue

    const content = readFileSync(filePath, 'utf8')
    const entries = parseEntries(content, file)

    for (const entry of entries) {
      const score = scoreEntry(entry, keywords)
      if (score > 0) {
        allMatches.push({
          file,
          content: entry.content,
          title: entry.title,
          score,
        })
      }
    }
  }

  // Apply phase-aware weighting and sort by weighted score descending
  const weighted = allMatches.map(m => ({
    match: m,
    weightedScore: m.score * phaseWeight(m, phase),
  }))
  weighted.sort((a, b) => b.weightedScore - a.weightedScore)

  // For 'evaluating' phase, filter out non-distilled entries entirely
  const filtered = phase === 'evaluating'
    ? weighted.filter(w => {
        const isDistilled = w.match.content.includes('[auto-distilled]') ||
          w.match.title.includes('[auto-distilled]')
        return isDistilled && w.match.file === 'lessons.md'
      })
    : weighted

  const sortedMatches = filtered.map(w => w.match)

  // Reinforce distilled strategies that are being returned
  const lessonsPath = join(dir, 'lessons.md')
  reinforceDistilledStrategies(sortedMatches, lessonsPath)

  // If relay URL provided, also search the relay
  if (opts.relayUrl) {
    let relayFormatted: string | null = null
    try {
      const recall: RecallResult = await relayRecall(
        taskDescription,
        taskDescription, // use task description as both what and learned for search
        {
          relayUrl: opts.relayUrl,
          agentHomeDir: opts.agentHomeDir,
          limit: 5,
          minScore: 0.3,
        }
      )
      if (recall.success && recall.count > 0) {
        relayFormatted = recall.formatted
      }
    } catch {
      // Relay search failure does not affect local results
    }

    return { local: sortedMatches, relay: relayFormatted } as any
  }

  return sortedMatches
}
