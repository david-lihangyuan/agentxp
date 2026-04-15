// diagnose.ts — Scan agent memory files for recurring error patterns.
// Pure local analysis: no LLM, no API keys, no network calls.

import { existsSync, readdirSync, readFileSync, mkdirSync, appendFileSync } from 'fs'
import { join, basename } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubPatternMatch {
  id: string
  description: string  // Narrative description template with {count} placeholder
  count: number
}

export interface PatternMatch {
  id: string        // 'unverified' | 'incomplete' | 'symptom-fix'
  title: string     // Short human-readable label
  count: number     // Sum of all sub-pattern counts
  subPatterns: SubPatternMatch[]  // Sub-pattern breakdown
  reflection: string // Rule to write into mistakes.md
}

export interface DiagnosisReport {
  filesScanned: number
  daysSpan: number           // Days inferred from file-name dates
  totalErrorEvents: number   // Sum of all pattern counts
  patterns: PatternMatch[]   // Only patterns with count >= 2, sorted desc
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface SubPatternDef {
  id: string
  description: string                  // Template with {count}
  keywords: (string | RegExp)[]
  requiresErrorContext: boolean        // If true, line must also pass hasErrorContext
  excludeKeywords?: (string | RegExp)[] // Lines matching any of these are skipped
}

interface PatternDef {
  id: string
  title: string
  reflection: string
  subPatterns: SubPatternDef[]
}

// Files to skip during scanning (philosophy docs, spec files, design docs, etc.)
const EXCLUDE_FILENAME_PATTERNS = [
  /PHILOSOPHY/i,
  /RULES/i,
  /SPEC/i,
  /\bspec\b/i,
  /design/i,
  /plan/i,
  /^insight-/i,
]

const PATTERN_DEFS: PatternDef[] = [
  {
    id: 'unverified',
    title: 'Acting on Unverified Assumptions',
    reflection: 'verify before acting',
    subPatterns: [
      {
        id: '1a',
        description: 'answered without checking data ({count} times)',
        keywords: [
          /without checking/i,
          /without verifying/i,
          /didn[\u2019']t verify/i,
          /didn[\u2019']t check/i,
          /没验证/,
          /不验证/,
          /没确认/,
        ],
        requiresErrorContext: true,
      },
      {
        id: '1b',
        description: 'fabricated outputs instead of running tools ({count} times)',
        keywords: [
          /\bfabricat/i,
          /\bmade up\b/i,
          /虚构/,
          /编造/,
          /叙述替代/,
          /没有工具调用/,
        ],
        requiresErrorContext: false,
      },
      {
        id: '1c',
        description: 'assumed infrastructure details that turned out wrong ({count} times)',
        keywords: [
          /wrong port/i,
          /wrong path/i,
          /wrong endpoint/i,
          /wrong file/i,
          /wrong url/i,
          /wrong schema/i,
          /以为.*端口/,
          /以为.*路径/,
          /假设.*错/,
          /错误端口/,
          /端口错配/,
        ],
        requiresErrorContext: false,
      },
    ],
  },
  {
    id: 'incomplete',
    title: 'Marking Work Done Before Complete',
    reflection: 'end-to-end verify before marking done',
    subPatterns: [
      {
        id: '2a',
        description: 'only completed partial changes ({count} times)',
        keywords: [
          /only half/i,
          /half done/i,
          /只移了/,
          /只做了一半/,
          /只改了/,
        ],
        requiresErrorContext: true,
      },
      {
        id: '2b',
        description: 'wrote code but never wired it up ({count} times)',
        keywords: [
          /wrote code but/i,
          /tests pass but/i,
          /implemented but/i,
          /写了但没/,
          /接了一半/,
          /代码.*但.*没挂/,
          /写了.*但.*没接/,
        ],
        requiresErrorContext: false,
      },
      {
        id: '2c',
        description: 'forgot to sync or update related files ({count} times)',
        keywords: [
          /not synced/i,
          /out of sync/i,
          /didn[\u2019']t update/i,
          /没同步/,
          /不同步/,
          /遗漏/,
          /没更新/,
          /忘了更新/,
        ],
        requiresErrorContext: true,
      },
      {
        id: '2d',
        description: 'overlooked items during review ({count} times)',
        keywords: [
          /\boverlooked\b/i,
          /\bleft out\b/i,
          /\bmissed\b/i,
          /脱节/,
        ],
        requiresErrorContext: true,
      },
    ],
  },
  {
    id: 'symptom-fix',
    title: 'Fixing Symptoms Instead of Root Causes',
    reflection: 'after fixing a bug, search all similar locations',
    subPatterns: [
      {
        id: '3a',
        description: 'fixed the same type of bug multiple times ({count} times)',
        keywords: [
          /same bug/i,
          /same error/i,
          /same issue/i,
          /同类.*bug/i,
          /同一天.*次/,
          /第.{0,3}次修/,
          /又一次/,
        ],
        requiresErrorContext: false,
      },
      {
        id: '3b',
        description: 'encountered recurring issues without root cause analysis ({count} times)',
        keywords: [
          /\brecurring\b/i,
          /\brepeated\b/i,
          /重复/,
          /\bagain\b/i,
        ],
        requiresErrorContext: true,
        excludeKeywords: [
          /root cause/i,
          /underlying/i,
          /systematic/i,
        ],
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

/**
 * Returns true if a file basename should be excluded from scanning.
 */
function shouldExcludeFile(filename: string): boolean {
  for (const pattern of EXCLUDE_FILENAME_PATTERNS) {
    if (pattern.test(filename)) return true
  }
  return false
}

/**
 * Collect candidate memory/reflection file paths from the workspace.
 * Returns deduplicated list of paths that exist.
 */
function collectFiles(workspaceDir: string): string[] {
  const candidates: string[] = []

  // memory/*.md (OpenClaw daily logs)
  const memoryDir = join(workspaceDir, 'memory')
  if (existsSync(memoryDir)) {
    try {
      for (const entry of readdirSync(memoryDir)) {
        if (entry.endsWith('.md') && !shouldExcludeFile(entry)) {
          candidates.push(join(memoryDir, entry))
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }

  // Top-level MEMORY.md
  const topMemory = join(workspaceDir, 'MEMORY.md')
  if (existsSync(topMemory)) candidates.push(topMemory)

  // Hermes memory
  const hermesMemory = join(workspaceDir, '.hermes', 'memories', 'MEMORY.md')
  if (existsSync(hermesMemory)) candidates.push(hermesMemory)

  // Existing reflection/mistakes.md
  const mistakesFile = join(workspaceDir, 'reflection', 'mistakes.md')
  if (existsSync(mistakesFile)) candidates.push(mistakesFile)

  // Deduplicate
  return [...new Set(candidates)]
}

// ---------------------------------------------------------------------------
// Error context detection
// ---------------------------------------------------------------------------

/**
 * Returns true if any line in the ±windowSize neighbourhood contains an
 * error-context marker. Used for dual-match sub-patterns.
 */
function hasErrorContext(lines: string[], lineIndex: number, windowSize = 2): boolean {
  const errorMarkers = /\[!\]|错|error|fail|bug|fix|wrong|修复|问题|broke|crash/i
  const start = Math.max(0, lineIndex - windowSize)
  const end = Math.min(lines.length - 1, lineIndex + windowSize)
  for (let i = start; i <= end; i++) {
    if (errorMarkers.test(lines[i])) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * Match a single sub-pattern against all file contents.
 */
function matchSubPattern(
  def: SubPatternDef,
  lines: string[]
): number {
  let count = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue

    // Check primary keywords
    let matched = false
    for (const kw of def.keywords) {
      const re = kw instanceof RegExp ? kw : new RegExp(kw, 'i')
      if (re.test(trimmed)) {
        matched = true
        break
      }
    }
    if (!matched) continue

    // Check exclude keywords (if any)
    if (def.excludeKeywords) {
      let excluded = false
      for (const exkw of def.excludeKeywords) {
        const re = exkw instanceof RegExp ? exkw : new RegExp(exkw, 'i')
        if (re.test(trimmed)) {
          excluded = true
          break
        }
      }
      if (excluded) continue
    }

    // Dual-match: require error context window
    if (def.requiresErrorContext) {
      if (!hasErrorContext(lines, i)) continue
    }

    count++
  }

  return count
}

// ---------------------------------------------------------------------------
// Date span inference
// ---------------------------------------------------------------------------

/**
 * Extract YYYY-MM-DD dates from file names and return the span in days.
 * Returns 0 if fewer than 2 dates found.
 */
function inferDaysSpan(filePaths: string[]): number {
  const dateRe = /(\d{4}-\d{2}-\d{2})/
  const timestamps: number[] = []

  for (const p of filePaths) {
    const name = basename(p)
    const m = dateRe.exec(name)
    if (m) {
      const ts = Date.parse(m[1])
      if (!isNaN(ts)) timestamps.push(ts)
    }
  }

  if (timestamps.length < 2) return timestamps.length === 0 ? 0 : 1
  const min = Math.min(...timestamps)
  const max = Math.max(...timestamps)
  return Math.round((max - min) / (1000 * 60 * 60 * 24)) + 1
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Scan workspace memory files and return a diagnosis report.
 */
export function diagnose(workspaceDir: string): DiagnosisReport {
  const filePaths = collectFiles(workspaceDir)

  if (filePaths.length === 0) {
    return {
      filesScanned: 0,
      daysSpan: 0,
      totalErrorEvents: 0,
      patterns: [],
    }
  }

  // Read all file contents, split into lines
  const allLines: string[] = []
  for (const fp of filePaths) {
    try {
      const content = readFileSync(fp, 'utf8')
      allLines.push(...content.split('\n'))
    } catch {
      // skip unreadable files
    }
  }

  const daysSpan = inferDaysSpan(filePaths)

  // Run detectors
  const patterns: PatternMatch[] = []
  let totalErrorEvents = 0

  for (const def of PATTERN_DEFS) {
    const subPatterns: SubPatternMatch[] = []
    let patternTotal = 0

    for (const subDef of def.subPatterns) {
      const count = matchSubPattern(subDef, allLines)
      subPatterns.push({
        id: subDef.id,
        description: subDef.description,
        count,
      })
      patternTotal += count
    }

    totalErrorEvents += patternTotal

    if (patternTotal >= 2) {
      patterns.push({
        id: def.id,
        title: def.title,
        count: patternTotal,
        subPatterns,
        reflection: def.reflection,
      })
    }
  }

  // Sort descending by count
  patterns.sort((a, b) => b.count - a.count)

  return {
    filesScanned: filePaths.length,
    daysSpan,
    totalErrorEvents,
    patterns,
  }
}

// ---------------------------------------------------------------------------
// Write to reflection/mistakes.md
// ---------------------------------------------------------------------------

/**
 * Append detected patterns as structured entries to reflection/mistakes.md.
 * Never overwrites existing content.
 */
export function writeDiagnosisToMistakes(
  report: DiagnosisReport,
  reflectionDir: string
): void {
  if (report.patterns.length === 0) return

  mkdirSync(reflectionDir, { recursive: true })
  const mistakesPath = join(reflectionDir, 'mistakes.md')

  const date = new Date().toISOString().slice(0, 10)
  const lines: string[] = []

  for (const pattern of report.patterns) {
    lines.push('')
    lines.push(`## ${date} ${pattern.title} (auto-detected by AgentXP)`)
    lines.push(`- Pattern: ${pattern.title}`)
    lines.push(`- Frequency: ${pattern.count} times in ${report.daysSpan} days`)
    lines.push(`- Rule: ${pattern.reflection}`)
    lines.push(`- Tags: auto-detected, install-scan`)
  }

  appendFileSync(mistakesPath, lines.join('\n') + '\n', 'utf8')
}
