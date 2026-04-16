/**
 * extraction-engine.ts — Experience extraction from tool call buffers and text.
 *
 * Two extraction modes:
 * - Mode A (primary): Detect patterns in ToolCallRecord buffers (error→fix→success, etc.)
 * - Mode B (secondary): Detect patterns in message text ("the issue was...", "原因是...", etc.)
 *
 * Pipeline: input → pattern detect → structure → quality gate → sanitize → Lesson | null
 */

import type { Lesson } from './db.js'
import { sanitizeBeforeStore } from './sanitize.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ToolCallRecord {
  toolName: string
  params: { path?: string }
  result?: string
  error?: string
  durationMs?: number
}

// ─── Quality Gate ──────────────────────────────────────────────────────────

/**
 * Technical noun pattern: XxxError, /path/file.ext, filename.ext, or method()
 */
const TECHNICAL_NOUN_RE = /[A-Z][a-z]+Error|\/[\w/]+\.\w+|\b[\w-]+\.(?:ts|js|tsx|jsx|py|rs|go|json|yaml|yml|toml|md|sql|sh|css|html|vue|svelte|rb|java|c|cpp|h|hpp|swift|kt|conf|cfg|ini|env|lock|xml)\b|\b\w+\(\)|\b(?:src|dist|node_modules|migrations?)\/[\w./-]*/

/**
 * Quality gate: ensures a lesson meets minimum bar for usefulness.
 * - what >= 10 chars
 * - learned >= 20 chars
 * - learned contains at least one technical noun
 */
export function qualityGate(lesson: {
  what: string
  tried: string
  outcome: string
  learned: string
}): boolean {
  if (!lesson.what || lesson.what.length < 10) return false
  if (!lesson.learned || lesson.learned.length < 20) return false
  if (!TECHNICAL_NOUN_RE.test(lesson.learned)) return false
  return true
}

// ─── Mode A: Tool Call Extraction ──────────────────────────────────────────

/**
 * Detect error→fix→success: at least one error followed by a success.
 */
function detectErrorFixSuccess(
  buffer: ToolCallRecord[],
): { errorRec: ToolCallRecord; fixRecs: ToolCallRecord[]; successRec: ToolCallRecord } | null {
  let firstError: ToolCallRecord | null = null
  let firstErrorIdx = -1

  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i].error) {
      firstError = buffer[i]
      firstErrorIdx = i
      break
    }
  }

  if (!firstError || firstErrorIdx === -1) return null

  // Look for a success after the error (no error, has result)
  let successRec: ToolCallRecord | null = null
  let successIdx = -1
  for (let i = firstErrorIdx + 1; i < buffer.length; i++) {
    if (!buffer[i].error && buffer[i].result) {
      successRec = buffer[i]
      successIdx = i
      // Keep looking for the last success
    }
  }

  if (!successRec || successIdx === -1) return null

  // Everything between error and success = fix steps
  const fixRecs = buffer.slice(firstErrorIdx + 1, successIdx)

  return { errorRec: firstError, fixRecs, successRec }
}

/**
 * Detect read→edit→test-pass: read, then edit/write, then exec with pass indicators.
 */
function detectReadEditTestPass(
  buffer: ToolCallRecord[],
): { readRec: ToolCallRecord; editRec: ToolCallRecord; testRec: ToolCallRecord } | null {
  let readRec: ToolCallRecord | null = null
  let editRec: ToolCallRecord | null = null
  let testRec: ToolCallRecord | null = null

  for (const rec of buffer) {
    if (!readRec && rec.toolName === 'read' && !rec.error) {
      readRec = rec
    } else if (
      readRec &&
      !editRec &&
      (rec.toolName === 'edit' || rec.toolName === 'write') &&
      !rec.error
    ) {
      editRec = rec
    } else if (
      editRec &&
      !testRec &&
      rec.toolName === 'exec' &&
      !rec.error &&
      rec.result &&
      /pass|success|ok|✓/i.test(rec.result)
    ) {
      testRec = rec
    }
  }

  if (!readRec || !editRec || !testRec) return null
  return { readRec, editRec, testRec }
}

/**
 * Truncate a string to maxLen, appending "..." if truncated.
 */
function truncate(s: string | undefined, maxLen: number): string {
  if (!s) return ''
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s
}

/**
 * Extract a file path from a record's params or result/error text.
 */
function extractPath(rec: ToolCallRecord): string {
  if (rec.params.path) return rec.params.path
  const pathMatch = (rec.error ?? rec.result ?? '').match(/(\/[\w./-]+\.\w+)/)
  return pathMatch ? pathMatch[1] : ''
}

/**
 * Extract error name from error text (e.g. "TypeError", "ModuleNotFoundError").
 */
function extractErrorName(errorText: string): string {
  const match = errorText.match(/([A-Z][a-zA-Z]*Error)/)
  return match ? match[1] : 'error'
}

/**
 * Mode A: Extract a lesson from a buffer of tool call records.
 *
 * Detects patterns:
 * 1. error → fix → success
 * 2. read → edit → test pass
 * 3. exec fail → exec success
 */
export function extractFromToolCalls(buffer: ToolCallRecord[]): Omit<Lesson, 'id'> | null {
  if (buffer.length < 2) return null

  // Pattern 1: error → fix → success
  const errorFix = detectErrorFixSuccess(buffer)
  if (errorFix) {
    const { errorRec, fixRecs, successRec } = errorFix
    const errorName = extractErrorName(errorRec.error!)
    const errorPath = extractPath(errorRec)
    const fixPaths = fixRecs
      .map(r => extractPath(r))
      .filter(Boolean)
    const fixDesc = fixPaths.length > 0
      ? `Edited ${fixPaths.join(', ')}`
      : fixRecs.length > 0
        ? `Applied ${fixRecs.length} fix step(s) using ${[...new Set(fixRecs.map(r => r.toolName))].join(', ')}`
        : 'Applied fix directly'

    const raw = {
      what: `${errorName} encountered${errorPath ? ` in ${errorPath}` : ''}: ${truncate(errorRec.error, 150)}`,
      tried: fixDesc,
      outcome: `Success: ${truncate(successRec.result, 150)}`,
      learned: `${errorName} was resolved${errorPath ? ` in ${errorPath}` : ''} by diagnosing the root cause and applying targeted fixes. ${truncate(errorRec.error, 100)}`,
      source: 'local' as const,
      tags: ['auto-extracted', 'tool-pattern'],
    }

    if (!qualityGate(raw)) return null
    return sanitizeBeforeStore(raw)
  }

  // Pattern 2: read → edit → test pass
  const readEdit = detectReadEditTestPass(buffer)
  if (readEdit) {
    const { readRec, editRec, testRec } = readEdit
    const readPath = extractPath(readRec)
    const editPath = extractPath(editRec)

    const raw = {
      what: `Modified ${editPath || readPath || 'source file'} after reading ${readPath || 'source'}`,
      tried: `Read ${readPath || 'file'}, then edited ${editPath || readPath || 'file'}`,
      outcome: `Tests passed: ${truncate(testRec.result, 150)}`,
      learned: `Successfully modified ${editPath || readPath || 'file'} — read() the file first, then applied edit(). Tests confirmed the change was correct via exec().`,
      source: 'local' as const,
      tags: ['auto-extracted', 'tool-pattern'],
    }

    if (!qualityGate(raw)) return null
    return sanitizeBeforeStore(raw)
  }

  return null
}

// ─── Mode B: Text Extraction ───────────────────────────────────────────────

interface TextPattern {
  /** Pattern to detect in text */
  detect: RegExp
  /** Extract structured lesson from matched text */
  extract: (text: string, match: RegExpMatchArray) => {
    what: string
    tried: string
    outcome: string
    learned: string
  } | null
}

/**
 * Extract a sentence or clause starting at a position.
 * Grabs text from the match position to the next sentence boundary.
 */
function extractClause(text: string, startIdx: number, maxLen = 300): string {
  const rest = text.slice(startIdx)
  // Find sentence end: period followed by space/end, or Chinese period, or end of text
  const endMatch = rest.match(/[.。!！?\?？]\s|$/)
  const endIdx = endMatch?.index !== undefined ? endMatch.index + 1 : rest.length
  return rest.slice(0, Math.min(endIdx, maxLen)).trim()
}

/**
 * Try to find a technical noun in the text for context.
 */
function findTechContext(text: string): string {
  const match = text.match(/([A-Z][a-z]+Error|\/[\w/]+\.\w+|\b\w+\(\))/)
  return match ? match[1] : ''
}

const TEXT_PATTERNS: TextPattern[] = [
  // "the issue was X... fixed by Y"
  {
    detect: /the issue was\s+/i,
    extract: (text, match) => {
      const issueStart = match.index! + match[0].length
      const issueClause = extractClause(text, issueStart)
      const fixMatch = text.match(/fixed by\s+/i)
      const fixClause = fixMatch
        ? extractClause(text, fixMatch.index! + fixMatch[0].length)
        : ''

      return {
        what: `Issue: ${issueClause}`,
        tried: fixClause ? `Fix: ${fixClause}` : 'Applied fix based on diagnosis',
        outcome: 'Issue resolved',
        learned: fixClause
          ? `${issueClause} — resolved by ${fixClause}`
          : issueClause,
      }
    },
  },
  // "the problem was X... the solution is Y"
  {
    detect: /the problem was\s+/i,
    extract: (text, match) => {
      const problemStart = match.index! + match[0].length
      const problemClause = extractClause(text, problemStart)
      const solMatch = text.match(/the solution is\s+/i)
      const solClause = solMatch
        ? extractClause(text, solMatch.index! + solMatch[0].length)
        : ''

      return {
        what: `Problem: ${problemClause}`,
        tried: solClause || 'Investigation',
        outcome: 'Resolved',
        learned: solClause
          ? `${problemClause} — solution: ${solClause}`
          : problemClause,
      }
    },
  },
  // "I learned that..."
  {
    detect: /I learned that\s+/i,
    extract: (text, match) => {
      const learnedClause = extractClause(text, match.index! + match[0].length)
      const tech = findTechContext(text)
      return {
        what: tech ? `Insight about ${tech}` : `Insight: ${truncate(learnedClause, 60)}`,
        tried: 'Through experience',
        outcome: 'Understanding gained',
        learned: learnedClause,
      }
    },
  },
  // "turns out..."
  {
    detect: /turns out\s+/i,
    extract: (text, match) => {
      const clause = extractClause(text, match.index! + match[0].length)
      const tech = findTechContext(text)
      return {
        what: tech ? `Discovery about ${tech}` : `Discovery: ${truncate(clause, 60)}`,
        tried: 'Investigation and debugging',
        outcome: 'Root cause found',
        learned: clause,
      }
    },
  },
  // Chinese: "原因是..."
  {
    detect: /原因是\s*/,
    extract: (text, match) => {
      const clause = extractClause(text, match.index! + match[0].length)
      const tech = findTechContext(text)
      // Also check for "解决了" in the text
      const solMatch = text.match(/解决了[，,]?\s*/)
      const solClause = solMatch
        ? extractClause(text, solMatch.index! + solMatch[0].length)
        : ''

      return {
        what: tech ? `${tech} 相关问题` : `问题分析: ${truncate(clause, 60)}`,
        tried: solClause || '排查与诊断',
        outcome: solMatch ? '已解决' : '发现原因',
        learned: solClause
          ? `${clause}。解决方式: ${solClause}`
          : clause,
      }
    },
  },
  // Chinese: "发现..."
  {
    detect: /发现\s+/,
    extract: (text, match) => {
      const clause = extractClause(text, match.index! + match[0].length)
      const tech = findTechContext(text)
      return {
        what: tech ? `关于 ${tech} 的发现` : `发现: ${truncate(clause, 60)}`,
        tried: '调试与排查',
        outcome: '确认了根因',
        learned: clause,
      }
    },
  },
  // "solved" / "the solution is"
  {
    detect: /\bsolved\b/i,
    extract: (text, _match) => {
      const tech = findTechContext(text)
      const clause = extractClause(text, 0, 300)
      return {
        what: tech ? `Resolved ${tech}` : `Resolved issue`,
        tried: 'Debugging and investigation',
        outcome: 'Solved',
        learned: clause,
      }
    },
  },
]

/**
 * Mode B: Extract a lesson from message text content.
 *
 * Detects patterns like "the issue was...", "I learned that...",
 * "原因是...", "解决了", etc.
 */
export function extractFromText(text: string): Omit<Lesson, 'id'> | null {
  if (!text || text.trim().length < 20) return null

  for (const pattern of TEXT_PATTERNS) {
    const match = text.match(pattern.detect)
    if (!match) continue

    const extracted = pattern.extract(text, match)
    if (!extracted) continue

    const raw = {
      ...extracted,
      source: 'local' as const,
      tags: ['auto-extracted', 'text-pattern'],
    }

    if (!qualityGate(raw)) continue
    return sanitizeBeforeStore(raw)
  }

  return null
}
