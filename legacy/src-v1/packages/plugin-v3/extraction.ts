/**
 * extraction.ts — Parse structured reflections (§5.4 format) and classify them.
 *
 * All functions are pure — no DB dependency. DB interaction happens at the caller (hooks).
 * Architecture: plugin-v3/docs/plans/plugin-v3/02-reflection-core.md §1
 *
 * Tech stack: TypeScript ESM, strict mode, no external dependencies.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReflectionOutcome = 'succeeded' | 'failed' | 'partial'
export type ReflectionCategory = 'mistake' | 'lesson' | 'feeling' | 'thought'

export interface ParsedReflection {
  title: string
  tried: string | null
  expected: string | null
  outcome: ReflectionOutcome | null
  learned: string | null
  whyWrong: string | null
  tags: string[]
}

// ─── Regex patterns ───────────────────────────────────────────────────────────

// Matches: ## [optional date] [title]
// Date is optional: "## 2026-04-11 Title" or "## Title"
const HEADER_RE = /^##\s+(?:\d{4}-\d{2}-\d{2}\s+)?(.+)$/m

const FIELD_RE: Record<string, RegExp> = {
  tried:    /^-\s+Tried:\s*(.+)$/im,
  expected: /^-\s+Expected:\s*(.+)$/im,
  outcome:  /^-\s+Outcome:\s*(.+)$/im,
  learned:  /^-\s+Learned:\s*(.+)$/im,
  tags:     /^-\s+Tags:\s*(.+)$/im,
  // Why I thought ... / Why wrong / Why I was wrong
  whyWrong: /^-\s+Why(?:\s+I\s+thought[^:]*|(?:\s+wrong)?(?:\s+I\s+was\s+wrong)?):\s*(.+)$/im,
}

// ─── Outcome normalizer ───────────────────────────────────────────────────────

function normalizeOutcome(raw: string | undefined | null): ReflectionOutcome | null {
  if (!raw || typeof raw !== 'string') return null
  const lower = raw.toLowerCase().trim()
  if (/^(fail(ed)?|failure)/.test(lower)) return 'failed'
  if (/^(succeed(ed)?|success|passed|pass)/.test(lower)) return 'succeeded'
  if (/^partial/.test(lower)) return 'partial'
  return null
}

// ─── parseReflection ─────────────────────────────────────────────────────────

/**
 * Parse a single reflection block (§5.4 format) into a structured object.
 * Returns null if the text doesn't contain a recognizable reflection header.
 */
export function parseReflection(text: string): ParsedReflection | null {
  if (!text || !text.trim()) return null

  const headerMatch = HEADER_RE.exec(text)
  if (!headerMatch) return null

  const title = headerMatch[1].trim()

  const extract = (key: string): string | null => {
    const m = FIELD_RE[key].exec(text)
    return m ? m[1].trim() : null
  }

  const rawOutcome = extract('outcome')
  const outcome = rawOutcome ? normalizeOutcome(rawOutcome) : null

  const rawTags = extract('tags')
  const tags: string[] = rawTags
    ? rawTags.split(',').map(t => t.trim()).filter(Boolean)
    : []

  return {
    title,
    tried:    extract('tried'),
    expected: extract('expected'),
    outcome,
    learned:  extract('learned'),
    whyWrong: extract('whyWrong'),
    tags,
  }
}

// ─── parseMultipleReflections ─────────────────────────────────────────────────

/**
 * Split a text block on "## " headers and parse each section as a reflection.
 * Sections that don't parse (no recognizable header/fields) are silently skipped.
 */
export function parseMultipleReflections(text: string): ParsedReflection[] {
  if (!text || !text.trim()) return []

  // Split on ## headings but keep the ## prefix
  const sections = text.split(/(?=^##\s)/m)

  const results: ParsedReflection[] = []
  for (const section of sections) {
    const parsed = parseReflection(section.trim())
    if (parsed) results.push(parsed)
  }
  return results
}

// ─── classifyCategory ─────────────────────────────────────────────────────────

type ClassifyInput = {
  outcome?: string | null
  learned?: string | null
  tags: string[]
}

/**
 * Classify a reflection into mistake | lesson | feeling | thought.
 *
 * Priority:
 * 1. Explicit tag match
 * 2. Outcome-based inference
 * 3. Content-based (regex on learned field)
 * 4. Default: 'lesson'
 */
export function classifyCategory(input: ClassifyInput): ReflectionCategory {
  const { outcome, learned = '', tags } = input
  const lowerTags = tags.map(t => t.toLowerCase())
  const learnedStr = learned ?? ''

  // 1. Explicit tag match (first wins)
  if (lowerTags.some(t => t === 'mistake' || t === 'error')) return 'mistake'
  if (lowerTags.some(t => t === 'feeling' || t === 'emotion')) return 'feeling'
  if (lowerTags.some(t => t === 'thought' || t === 'question' || t === 'hypothesis')) return 'thought'
  if (lowerTags.some(t => t === 'lesson')) return 'lesson'

  // 2. Outcome-based
  if (outcome) {
    const norm = normalizeOutcome(outcome)
    if (norm === 'failed') return 'mistake'
    if (norm === 'succeeded' || norm === 'partial') return 'lesson'
  }

  // 3. Content-based
  const FEELING_RE = /\b(felt|frustrated|excited|overwhelmed|anxious|proud|sad|happy|angry|worried)\b/i
  const THOUGHT_RE = /\b(wonder|hypothesis|maybe|what\s+if|question|could\s+we|should\s+we|what\s+about)\b/i

  if (FEELING_RE.test(learnedStr)) return 'feeling'
  if (THOUGHT_RE.test(learnedStr)) return 'thought'

  // 4. Default
  return 'lesson'
}
