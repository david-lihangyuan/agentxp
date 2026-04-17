/**
 * cli.ts — CLI subcommands for AgentXP plugin.
 *
 * Exports pure functions (testable without OpenClaw framework)
 * and a thin registrar wrapper for the plugin API.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, basename } from 'path'
import type { Db, Lesson } from './db.js'
import type { PluginConfig } from './types.js'

// ─── Diagnose: Pattern definitions (ported from packages/skill/src/diagnose.ts) ──

interface SubPatternDef {
  id: string
  description: string
  keywords: (string | RegExp)[]
  requiresErrorContext: boolean
  excludeKeywords?: (string | RegExp)[]
}

interface PatternDef {
  id: string
  title: string
  reflection: string
  subPatterns: SubPatternDef[]
}

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

// ─── Diagnose helpers ──────────────────────────────────────────────────────

function shouldExcludeFile(filename: string): boolean {
  for (const pattern of EXCLUDE_FILENAME_PATTERNS) {
    if (pattern.test(filename)) return true
  }
  return false
}

function collectFiles(workspaceDir: string): string[] {
  const candidates: string[] = []

  const memoryDir = join(workspaceDir, 'memory')
  if (existsSync(memoryDir)) {
    try {
      for (const entry of readdirSync(memoryDir)) {
        if (entry.endsWith('.md') && !shouldExcludeFile(entry)) {
          candidates.push(join(memoryDir, entry))
        }
      }
    } catch {
      // ignore
    }
  }

  const topMemory = join(workspaceDir, 'MEMORY.md')
  if (existsSync(topMemory)) candidates.push(topMemory)

  const mistakesFile = join(workspaceDir, 'reflection', 'mistakes.md')
  if (existsSync(mistakesFile)) candidates.push(mistakesFile)

  return [...new Set(candidates)]
}

function hasErrorContext(lines: string[], lineIndex: number, windowSize = 2): boolean {
  const errorMarkers = /\[!\]|错|error|fail|bug|fix|wrong|修复|问题|broke|crash/i
  const start = Math.max(0, lineIndex - windowSize)
  const end = Math.min(lines.length - 1, lineIndex + windowSize)
  for (let i = start; i <= end; i++) {
    if (errorMarkers.test(lines[i])) return true
  }
  return false
}

function matchSubPattern(def: SubPatternDef, lines: string[]): number {
  let count = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue

    let matched = false
    for (const kw of def.keywords) {
      const re = kw instanceof RegExp ? kw : new RegExp(kw, 'i')
      if (re.test(trimmed)) { matched = true; break }
    }
    if (!matched) continue

    if (def.excludeKeywords) {
      let excluded = false
      for (const exkw of def.excludeKeywords) {
        const re = exkw instanceof RegExp ? exkw : new RegExp(exkw, 'i')
        if (re.test(trimmed)) { excluded = true; break }
      }
      if (excluded) continue
    }

    if (def.requiresErrorContext && !hasErrorContext(lines, i)) continue

    count++
  }
  return count
}

function inferDaysSpan(filePaths: string[]): number {
  const dateRe = /(\d{4}-\d{2}-\d{2})/
  const timestamps: number[] = []
  for (const p of filePaths) {
    const m = dateRe.exec(basename(p))
    if (m) {
      const ts = Date.parse(m[1])
      if (!isNaN(ts)) timestamps.push(ts)
    }
  }
  if (timestamps.length < 2) return timestamps.length === 0 ? 0 : 1
  return Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24)) + 1
}

export interface DiagnoseResult {
  filesScanned: number
  daysSpan: number
  totalErrorEvents: number
  patterns: Array<{
    id: string
    title: string
    count: number
    reflection: string
    subPatterns: Array<{ id: string; description: string; count: number }>
  }>
}

// ─── Pure CLI functions ────────────────────────────────────────────────────

/**
 * `openclaw agentxp status` — DB stats, FTS5 status, table row counts.
 */
export async function cliStatus(db: Db): Promise<string> {
  const lessonCount = db.getLessonCount()
  const fts5 = db.getFts5Status()
  const tableCounts = db.getTableCounts()
  const injectionStats = db.getInjectionStats()
  const traceStepCount = db.getTraceStepCount()

  const lines: string[] = [
    '=== AgentXP Status ===',
    '',
    `Lessons (active): ${lessonCount}`,
    `FTS5: ${fts5.available ? `enabled (${fts5.rowCount} indexed)` : 'unavailable'}`,
    '',
    '--- Table Row Counts ---',
  ]

  for (const [table, count] of Object.entries(tableCounts)) {
    lines.push(`  ${table}: ${count}`)
  }

  lines.push('')
  lines.push('--- Injection Stats ---')
  lines.push(`  Total sessions: ${injectionStats.total}`)
  lines.push(`  Injected: ${injectionStats.injected}`)
  lines.push('')
  lines.push(`Trace steps: ${traceStepCount}`)

  return lines.join('\n')
}

/**
 * `openclaw agentxp diagnose` — Scan workspace memory files for error patterns.
 */
export async function cliDiagnose(db: Db, workspaceDir: string): Promise<string> {
  const filePaths = collectFiles(workspaceDir)

  if (filePaths.length === 0) {
    return 'No memory files found to scan.'
  }

  const allLines: string[] = []
  for (const fp of filePaths) {
    try {
      allLines.push(...readFileSync(fp, 'utf8').split('\n'))
    } catch {
      // skip unreadable
    }
  }

  const daysSpan = inferDaysSpan(filePaths)
  let totalErrorEvents = 0
  const patternResults: DiagnoseResult['patterns'] = []

  for (const def of PATTERN_DEFS) {
    const subResults: Array<{ id: string; description: string; count: number }> = []
    let patternTotal = 0

    for (const subDef of def.subPatterns) {
      const count = matchSubPattern(subDef, allLines)
      subResults.push({ id: subDef.id, description: subDef.description, count })
      patternTotal += count
    }

    totalErrorEvents += patternTotal

    if (patternTotal >= 2) {
      patternResults.push({
        id: def.id,
        title: def.title,
        count: patternTotal,
        reflection: def.reflection,
        subPatterns: subResults,
      })
    }
  }

  patternResults.sort((a, b) => b.count - a.count)

  // Build output
  const lines: string[] = [
    '=== AgentXP Diagnosis ===',
    '',
    `Files scanned: ${filePaths.length}`,
    `Days span: ${daysSpan}`,
    `Total error events: ${totalErrorEvents}`,
  ]

  if (patternResults.length === 0) {
    lines.push('')
    lines.push('No recurring error patterns detected (threshold: 2+).')
  } else {
    for (const p of patternResults) {
      lines.push('')
      lines.push(`## ${p.title} (${p.count} occurrences)`)
      lines.push(`   Rule: ${p.reflection}`)
      for (const sub of p.subPatterns) {
        if (sub.count > 0) {
          lines.push(`   - ${sub.description.replace('{count}', String(sub.count))}`)
        }
      }
    }
  }

  return lines.join('\n')
}

/**
 * `openclaw agentxp distill` — Manually trigger distillation.
 */
export async function cliDistill(db: Db): Promise<string> {
  const groups = db.listLessonsForDistillation(5)

  if (groups.length === 0) {
    return 'No lesson groups ready for distillation (need 5+ lessons with same tag).'
  }

  const results: string[] = ['=== AgentXP Distillation ===', '']
  let mergedCount = 0

  for (const group of groups) {
    const { tag, lessons } = group

    const mergedWhat = `[strategy] ${tag}: consolidated from ${lessons.length} lessons`
    const mergedTried = lessons.map(l => l.tried).join(' | ')
    const mergedOutcome = lessons.map(l => l.outcome).join(' | ')
    const mergedLearned = lessons
      .map(l => l.learned)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join('; ')

    const allTags = [...new Set(lessons.flatMap(l => l.tags ?? []))]

    db.insertLesson({
      what: mergedWhat,
      tried: mergedTried,
      outcome: mergedOutcome,
      learned: mergedLearned,
      source: 'local',
      tags: allTags,
    })

    for (const lesson of lessons) {
      if (lesson.id != null) db.markOutdated(lesson.id)
    }

    results.push(`Merged ${lessons.length} lessons for tag "${tag}"`)
    mergedCount++
  }

  results.push('')
  results.push(`Done: ${mergedCount} group(s) distilled.`)
  return results.join('\n')
}

/**
 * `openclaw agentxp export` — Export lessons as JSON or JSONL.
 */
export async function cliExport(db: Db, format: 'json' | 'jsonl' = 'json'): Promise<string> {
  const lessons = db.listAllLessons()

  if (lessons.length === 0) {
    return format === 'json' ? '[]' : ''
  }

  if (format === 'jsonl') {
    return lessons.map(l => JSON.stringify(l)).join('\n')
  }

  return JSON.stringify(lessons, null, 2)
}

/**
 * Registrar wrapper for OpenClaw CLI framework.
 */
interface CliCommand {
  command(name: string): CliCommand
  description(text: string): CliCommand
  option(flags: string, description?: string, defaultValue?: unknown): CliCommand
  action(fn: (...args: unknown[]) => void | Promise<void>): CliCommand
}

export function createCliRegistrar(db: Db, config: PluginConfig) {
  return (ctx: { program: CliCommand }) => {
    const { program } = ctx

    const agentxp = program.command('agentxp').description('AgentXP experience learning management')

    agentxp.command('status')
      .description('Show AgentXP status and DB stats')
      .action(async () => {
        console.log(await cliStatus(db))
      })

    agentxp.command('diagnose')
      .description('Scan workspace memory files for error patterns')
      .action(async () => {
        const workspaceDir = config.mode === 'local' ? process.cwd() : process.cwd()
        console.log(await cliDiagnose(db, workspaceDir))
      })

    agentxp.command('distill')
      .description('Manually trigger lesson distillation')
      .action(async () => {
        console.log(await cliDistill(db))
      })

    agentxp.command('export')
      .description('Export lessons as JSON or JSONL')
      .option('--format <format>', 'json or jsonl', 'json')
      .action(async (...args: unknown[]) => {
        const opts = (args[0] as { format?: string } | undefined) ?? {}
        const fmt = opts.format === 'jsonl' ? 'jsonl' : 'json'
        console.log(await cliExport(db, fmt))
      })
  }
}
