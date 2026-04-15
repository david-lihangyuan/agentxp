// diagnose.ts — Scan agent memory files for recurring error patterns.
// Pure local analysis: no LLM, no API keys, no network calls.

import { existsSync, readdirSync, readFileSync, mkdirSync, appendFileSync } from 'fs'
import { join, basename } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternMatch {
  id: string        // 'unverified' | 'incomplete' | 'symptom-fix'
  title: string     // Short human-readable label
  count: number     // Number of keyword matches
  examples: string[] // Up to 3 matching lines, truncated to 80 chars
  reflection: string // Rule to write into mistakes.md
}

export interface DiagnosisReport {
  filesScanned: number
  daysSpan: number           // Days inferred from file-name dates
  totalErrorEvents: number   // All error-keyword matches across all patterns
  patterns: PatternMatch[]   // Only patterns with count >= 2, sorted desc
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface PatternDef {
  id: string
  title: string
  reflection: string
  keywords: (string | RegExp)[]
}

const PATTERN_DEFS: PatternDef[] = [
  {
    id: 'unverified',
    title: 'Acting on Unverified Assumptions',
    reflection: 'Always verify before acting. Check the actual file, port, URL, or endpoint instead of assuming.',
    keywords: [
      /\bassumed\b/i,
      /\bassumption\b/i,
      /thought it was/i,
      /turned out/i,
      /\bactually\b/i,
      /without checking/i,
      /without verifying/i,
      /didn['']t verify/i,
      /didn['']t check/i,
      /\bfabricat/i,
      /\bmade up\b/i,
      /\bhallucinate/i,
      /wrong port/i,
      /wrong path/i,
      /wrong endpoint/i,
      /wrong url/i,
      /wrong file/i,
      /没验证/,
      /不验证/,
      /没确认/,
      /想当然/,
      /以为/,
      /虚构/,
      /编造/,
      /假设.*错/,
    ],
  },
  {
    id: 'incomplete',
    title: 'Marking Work Done Before It Is Complete',
    reflection: 'Do not mark a task complete until all parts are verified: code, tests, docs, and synced state.',
    keywords: [
      /only half/i,
      /half done/i,
      /\bpartially\b/i,
      /\bincomplete\b/i,
      /forgot to/i,
      /\bmissed\b/i,
      /\boverlooked\b/i,
      /left out/i,
      /not synced/i,
      /out of sync/i,
      /didn['']t update/i,
      /wasn['']t updated/i,
      /wrote code but/i,
      /tests pass but/i,
      /implemented but/i,
      /只做了一半/,
      /只移了/,
      /\b遗漏/,
      /没更新/,
      /没同步/,
      /不同步/,
      /脱节/,
      /接了一半/,
      /写了但没/,
    ],
  },
  {
    id: 'symptom-fix',
    title: 'Fixing Symptoms Instead of Root Causes',
    reflection: 'When the same error recurs, stop and identify the root cause before patching the symptom again.',
    keywords: [
      /same bug/i,
      /same error/i,
      /same issue/i,
      /\bagain\b/i,
      /third time/i,
      /second time/i,
      /same type/i,
      /similar error/i,
      /\brecurring\b/i,
      /\brepeated\b/i,
      /root cause/i,
      /\bunderlying\b/i,
      /\bsystematic\b/i,
      /同类/,
      /同样的/,
      /又一次/,
      /第.{0,3}次修/,
      /同一天.{0,5}次/,
      /\b重复/,
    ],
  },
]

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

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
        if (entry.endsWith('.md')) {
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
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * Match a single pattern against all file contents.
 * Returns count + up to 3 example lines.
 */
function matchPattern(
  def: PatternDef,
  lines: string[]
): { count: number; examples: string[] } {
  let count = 0
  const examples: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let matched = false
    for (const kw of def.keywords) {
      const re = kw instanceof RegExp ? kw : new RegExp(kw, 'i')
      if (re.test(trimmed)) {
        matched = true
        break
      }
    }

    if (matched) {
      count++
      if (examples.length < 3) {
        // Truncate to 80 chars for display
        examples.push(trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed)
      }
    }
  }

  return { count, examples }
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
    const { count, examples } = matchPattern(def, allLines)
    totalErrorEvents += count
    if (count >= 2) {
      patterns.push({
        id: def.id,
        title: def.title,
        count,
        examples,
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
