/**
 * pattern-detector.ts — Detect repeated error patterns from memory files and reflections.
 *
 * Pure functions — no DB dependency. Operates on raw text or reflection summaries.
 * Architecture: plugin-v3/docs/plans/plugin-v3/02-reflection-core.md §4
 *
 * Tech stack: TypeScript ESM, strict mode, no external dependencies.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetectedPattern {
  keyword: string
  count: number
  context: string // example snippet
}

export interface ReflectionSummary {
  category: 'mistake' | 'lesson' | 'feeling' | 'thought'
  title: string
  createdAt: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Words that indicate error context in a line. */
const ERROR_INDICATORS = [
  'failed', 'fail', 'failure',
  'error', 'wrong', 'mistake',
  'denied', 'refused', 'cannot', 'can\'t',
  'timeout', 'broken', 'crash', 'missing',
  'incorrect', 'invalid', 'unexpected',
]

const ERROR_INDICATOR_RE = new RegExp(`\\b(${ERROR_INDICATORS.join('|')})\\b`, 'i')

/** Generic stopwords to filter out when extracting significant words. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'not',
  'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'it', 'its', 'this', 'that',
  'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
  'she', 'they', 'them', 'his', 'her', 'their', 'again', 'same', 'just',
  'also', 'only', 'even', 'about', 'after', 'before', 'up', 'out', 'if',
  'then', 'than', 'there', 'when', 'where', 'who', 'which', 'how', 'what',
  'all', 'any', 'both', 'into', 'through', 'during', 'while',
  // error indicator words themselves (not significant keywords)
  ...ERROR_INDICATORS,
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Tokenize a string into lowercase words, filtering stopwords and short tokens.
 * Applies simple suffix normalization (plural -s, -ing, -ed) for better matching.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')   // strip punctuation
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w))
    .map(normalize)
}

/**
 * Simple word normalization: strip common suffixes to improve grouping.
 * e.g. "imports" → "import", "checking" → "check", "failed" → "fail"
 */
function normalize(word: string): string {
  // Strip trailing -ing (>= 6 chars): checking → check
  if (word.length >= 6 && word.endsWith('ing')) return word.slice(0, -3)
  // Strip trailing -tion (>= 7 chars): verification → verif (avoid over-strip)
  // Actually skip -tion, too aggressive
  // Strip trailing -ed (>= 5 chars): skipped → skip, missed → miss
  if (word.length >= 5 && word.endsWith('ed')) {
    const stem = word.slice(0, -2)
    // Handle doubled consonant: skipped → skip
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
      return stem.slice(0, -1)
    }
    return stem
  }
  // Strip trailing -s (>= 5 chars, not -ss): imports → import
  if (word.length >= 5 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

// ─── detectPatternsFromText ───────────────────────────────────────────────────

/**
 * Detect error patterns from raw text (MEMORY.md, log files, etc.).
 *
 * Algorithm:
 * 1. Split content into lines
 * 2. Keep lines that contain error indicator words
 * 3. Tokenize those lines → significant words
 * 4. Count word frequency across error lines
 * 5. Words appearing >= 3 times = detected pattern
 */
export function detectPatternsFromText(content: string): DetectedPattern[] {
  if (!content || !content.trim()) return []

  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  const errorLines = lines.filter(l => ERROR_INDICATOR_RE.test(l))

  if (errorLines.length === 0) return []

  // Count occurrences of each significant word across error lines
  const wordCount = new Map<string, number>()
  const wordContext = new Map<string, string>()

  for (const line of errorLines) {
    const words = tokenize(line)
    for (const word of words) {
      const prev = wordCount.get(word) ?? 0
      wordCount.set(word, prev + 1)
      if (!wordContext.has(word)) {
        // Store first occurrence as context snippet
        wordContext.set(word, line.slice(0, 80))
      }
    }
  }

  // Build patterns for words appearing 3+ times
  const patterns: DetectedPattern[] = []
  wordCount.forEach((count, keyword) => {
    if (count >= 3) {
      patterns.push({
        keyword,
        count,
        context: wordContext.get(keyword) ?? '',
      })
    }
  })

  // Sort by count descending
  return patterns.sort((a, b) => b.count - a.count)
}

// ─── detectRepeatedErrors ────────────────────────────────────────────────────

/**
 * Detect repeated error patterns from structured reflection records.
 *
 * Algorithm:
 * 1. Filter to mistakes within the time window
 * 2. Tokenize each title into significant words
 * 3. Count word frequency across mistake titles
 * 4. Words appearing >= minCount times = repeated pattern
 */
export function detectRepeatedErrors(
  reflections: ReflectionSummary[],
  opts: { windowDays: number; minCount: number },
): DetectedPattern[] {
  const { windowDays, minCount } = opts
  const windowMs = windowDays * 24 * 60 * 60 * 1000
  const cutoff = Date.now() - windowMs

  // Filter: only mistakes within time window
  const recentMistakes = reflections.filter(
    r => r.category === 'mistake' && r.createdAt >= cutoff,
  )

  if (recentMistakes.length < minCount) return []

  // Count word frequency across mistake titles
  const wordCount = new Map<string, number>()
  const wordContext = new Map<string, string>()

  for (const reflection of recentMistakes) {
    const words = tokenize(reflection.title)
    for (const word of words) {
      const prev = wordCount.get(word) ?? 0
      wordCount.set(word, prev + 1)
      if (!wordContext.has(word)) {
        wordContext.set(word, reflection.title)
      }
    }
  }

  // Build patterns for words appearing >= minCount times
  const patterns: DetectedPattern[] = []
  wordCount.forEach((count, keyword) => {
    if (count >= minCount) {
      patterns.push({
        keyword,
        count,
        context: wordContext.get(keyword) ?? '',
      })
    }
  })

  return patterns.sort((a, b) => b.count - a.count)
}
