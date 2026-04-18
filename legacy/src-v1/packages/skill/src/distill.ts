// distill.ts — HEM-inspired Experience Distillation Engine
// Scans reflection/mistakes.md, groups errors by pattern, and auto-extracts
// strategy rules into reflection/lessons.md when a pattern accumulates 5+ cases.
// Pure local analysis: no LLM, no API keys, no network calls.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyRule {
  /** Unique sequential ID, e.g. 'sr_001' */
  id: string
  /** Pattern name — one of the three built-in ids or a custom tag */
  pattern: string
  /** Human-readable rule text */
  ruleText: string
  /** Confidence score 0–1 (starts at 0.5, grows with more supporting mistakes) */
  confidence: number
  /** Number of mistakes that support this strategy */
  supportingCount: number
  /** ISO date string: when this rule was first created */
  createdAt: string
  /** ISO date string: last time proactive-recall surfaced this rule */
  lastReinforced: string
  /** How many times proactive-recall has returned this rule */
  timesApplied: number
  /** How many times the user marked this rule helpful (reserved for future use) */
  timesHelpful: number
}

export interface ExperienceDistillResult {
  /** Number of brand-new strategy rules written to lessons.md */
  newRules: number
  /** Number of existing strategy rules updated (confidence raised) */
  updatedRules: number
  /** Total auto-distilled strategies currently in lessons.md */
  totalStrategies: number
}

// ---------------------------------------------------------------------------
// Built-in pattern keyword sets (mirroring diagnose.ts)
// ---------------------------------------------------------------------------

const BUILT_IN_PATTERNS: Record<string, { title: string; keywords: (string | RegExp)[] }> = {
  unverified: {
    title: 'Acting on Unverified Assumptions',
    keywords: [
      /\bassumed\b/i,
      /\bassumption\b/i,
      /thought it was/i,
      /turned out/i,
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
  incomplete: {
    title: 'Marking Work Done Before It Is Complete',
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
  'symptom-fix': {
    title: 'Fixing Symptoms Instead of Root Causes',
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
}

// Strategy rule text templates for built-in patterns
const BUILT_IN_RULE_TEXT: Record<string, string> = {
  unverified:
    'Before answering any factual question, verify the claim by checking source data. ' +
    'Before assuming infrastructure details (ports, paths, schemas), confirm them with a direct check.',
  incomplete:
    'Before marking any task as complete, do an end-to-end verification. ' +
    'Check: are all files synced? Are all imports updated? ' +
    'Does the feature work in production, not just in tests?',
  'symptom-fix':
    'After fixing a bug, search the entire codebase for the same pattern. ' +
    'If found in 2+ places, fix all instances and add a note about the systematic issue.',
}

// ---------------------------------------------------------------------------
// Parsing mistakes.md
// ---------------------------------------------------------------------------

interface MistakeEntry {
  /** Full text of the section */
  text: string
  /** Tags extracted from "- Tags: ..." line */
  tags: string[]
}

/**
 * Parse mistakes.md into individual entries (## sections).
 * Extracts tags from lines matching "- Tags: ..." or "Tags: ...".
 */
function parseMistakes(content: string): MistakeEntry[] {
  const entries: MistakeEntry[] = []
  const sections = content.split(/^## /m).filter(s => s.trim())

  for (const section of sections) {
    const text = section.trim()
    if (!text) continue

    // Extract tags from "- Tags: foo, bar" line
    const tagsMatch = text.match(/^[-\s]*Tags:\s*(.+)$/im)
    const tags: string[] = tagsMatch
      ? tagsMatch[1].split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      : []

    entries.push({ text, tags })
  }

  return entries
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

interface PatternGroup {
  pattern: string
  title: string
  count: number
  isBuiltIn: boolean
}

/**
 * Group mistakes by pattern.
 * Strategy:
 * 1. For each entry, check its tags against built-in pattern ids.
 * 2. Also check entry text against built-in keyword lists.
 * 3. Collect custom tags (not in built-in patterns and not meta-tags).
 */
function groupByPattern(entries: MistakeEntry[]): PatternGroup[] {
  const META_TAGS = new Set([
    'auto-detected',
    'install-scan',
    'auto-distilled',
    'reflection',
    'mistake',
    'lesson',
  ])

  // Count per pattern
  const counts = new Map<string, number>()

  for (const entry of entries) {
    const matched = new Set<string>()

    // 1. Check tags for built-in pattern ids
    for (const tag of entry.tags) {
      if (BUILT_IN_PATTERNS[tag]) {
        matched.add(tag)
      }
    }

    // 2. Check text against built-in keyword lists
    const lines = entry.text.split('\n')
    for (const [patternId, def] of Object.entries(BUILT_IN_PATTERNS)) {
      if (matched.has(patternId)) continue // already matched via tag
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        for (const kw of def.keywords) {
          const re = kw instanceof RegExp ? kw : new RegExp(kw, 'i')
          if (re.test(trimmed)) {
            matched.add(patternId)
            break
          }
        }
        if (matched.has(patternId)) break
      }
    }

    // 3. Collect custom tags (not meta, not built-in)
    for (const tag of entry.tags) {
      if (!META_TAGS.has(tag) && !BUILT_IN_PATTERNS[tag]) {
        matched.add(tag)
      }
    }

    // Increment counts
    for (const p of matched) {
      counts.set(p, (counts.get(p) ?? 0) + 1)
    }
  }

  // Build result
  const groups: PatternGroup[] = []
  for (const [pattern, count] of counts) {
    const isBuiltIn = !!BUILT_IN_PATTERNS[pattern]
    const title = isBuiltIn
      ? BUILT_IN_PATTERNS[pattern].title
      : pattern.charAt(0).toUpperCase() + pattern.slice(1).replace(/-/g, ' ')
    groups.push({ pattern, title, count, isBuiltIn })
  }

  return groups
}

// ---------------------------------------------------------------------------
// Lessons.md parsing
// ---------------------------------------------------------------------------

interface ExistingStrategy {
  /** Pattern id this strategy covers */
  pattern: string
  /** Current supporting count parsed from the entry */
  supportingCount: number
  /** Current confidence parsed from the entry */
  confidence: number
  /** Current timesApplied */
  timesApplied: number
  /** Full header line, e.g. "## 2024-01-01 Acting on Unverified Assumptions [auto-distilled]" */
  headerLine: string
}

/**
 * Parse lessons.md and return all [auto-distilled] strategy entries.
 */
function parseExistingStrategies(content: string): ExistingStrategy[] {
  const strategies: ExistingStrategy[] = []
  const sections = content.split(/^## /m).filter(s => s.trim())

  for (const section of sections) {
    const lines = section.split('\n')
    const header = lines[0]?.trim() ?? ''

    // Must have [auto-distilled] marker
    if (!header.includes('[auto-distilled]')) continue

    // Extract Pattern id
    const patternMatch = section.match(/^[-\s]*Pattern:\s*(.+)$/im)
    if (!patternMatch) continue
    const pattern = patternMatch[1].trim()

    // Extract supporting count
    const countMatch = section.match(/^[-\s]*Based on:\s*(\d+)/im)
    const supportingCount = countMatch ? parseInt(countMatch[1], 10) : 0

    // Extract confidence
    const confMatch = section.match(/^[-\s]*Confidence:\s*([\d.]+)/im)
    const confidence = confMatch ? parseFloat(confMatch[1]) : 0.5

    // Extract timesApplied
    const appliedMatch = section.match(/^[-\s]*TimesApplied:\s*(\d+)/im)
    const timesApplied = appliedMatch ? parseInt(appliedMatch[1], 10) : 0

    strategies.push({
      pattern,
      supportingCount,
      confidence,
      timesApplied,
      headerLine: `## ${header}`,
    })
  }

  return strategies
}

/**
 * Count all [auto-distilled] strategies in lessons.md.
 */
function countStrategies(content: string): number {
  const matches = content.match(/\[auto-distilled\]/g)
  return matches ? matches.length : 0
}

// ---------------------------------------------------------------------------
// Strategy ID generation
// ---------------------------------------------------------------------------

/**
 * Generate the next strategy rule ID based on existing content.
 * Scans lessons.md for existing sr_NNN ids and increments.
 */
function nextStrategyId(lessonsContent: string): string {
  const matches = [...lessonsContent.matchAll(/sr_(\d+)/g)]
  if (matches.length === 0) return 'sr_001'
  const max = Math.max(...matches.map(m => parseInt(m[1], 10)))
  return `sr_${String(max + 1).padStart(3, '0')}`
}

// ---------------------------------------------------------------------------
// Strategy rule text generation
// ---------------------------------------------------------------------------

function ruleTextForPattern(pattern: string, count: number): string {
  if (BUILT_IN_RULE_TEXT[pattern]) {
    return BUILT_IN_RULE_TEXT[pattern]
  }
  return (
    `Pattern '${pattern}' detected ${count} times. ` +
    `Review past mistakes with this tag before starting similar work.`
  )
}

// ---------------------------------------------------------------------------
// Lessons.md writing
// ---------------------------------------------------------------------------

/**
 * Append a new strategy rule entry to lessons.md.
 */
function appendStrategy(lessonsPath: string, group: PatternGroup, id: string): void {
  const date = new Date().toISOString().slice(0, 10)
  const confidence = 0.5
  const ruleText = ruleTextForPattern(group.pattern, group.count)
  const patternTitle = group.title

  const entry = [
    '',
    `## ${date} ${patternTitle} [auto-distilled]`,
    `- Id: ${id}`,
    `- Rule: ${ruleText}`,
    `- Confidence: ${confidence.toFixed(2)}`,
    `- Based on: ${group.count} similar mistakes`,
    `- Pattern: ${group.pattern}`,
    `- TimesApplied: 0`,
    `- LastReinforced: ${date}`,
    `- Tags: auto-distilled, ${group.pattern}`,
    '',
  ].join('\n')

  // Ensure file ends with newline before appending
  let existing = existsSync(lessonsPath) ? readFileSync(lessonsPath, 'utf8') : ''
  if (existing && !existing.endsWith('\n')) existing += '\n'
  writeFileSync(lessonsPath, existing + entry, 'utf8')
}

/**
 * Update an existing auto-distilled strategy entry in lessons.md.
 * Increments supportingCount and confidence (+0.05 per new supporting mistake).
 * Uses a section-aware approach: splits by '## ', edits the matching section,
 * then reassembles.
 */
function updateStrategy(
  lessonsPath: string,
  existing: ExistingStrategy,
  newCount: number
): void {
  const content = readFileSync(lessonsPath, 'utf8')

  const delta = Math.max(0, newCount - existing.supportingCount)
  if (delta === 0) return // Nothing to update

  const newSupportingCount = newCount
  const newConfidence = Math.min(1.0, existing.confidence + delta * 0.05)

  // Split into sections. Each section (except the first) starts with '## '.
  // We keep the leading text before the first '## ' as a preamble.
  const parts = content.split(/(?=^## )/m)
  const updatedParts = parts.map(part => {
    // Only edit auto-distilled sections matching this pattern
    if (!part.includes('[auto-distilled]')) return part

    // Check that this section has the matching Pattern line
    const patternLineRe = new RegExp(`^[-\\s]*Pattern:\\s*${escapeRegex(existing.pattern)}\\s*$`, 'im')
    if (!patternLineRe.test(part)) return part

    // Replace "- Based on: N similar mistakes" in this section
    let updated = part.replace(
      /^([-\s]*Based on:\s*)\d+( similar mistakes)/im,
      `$1${newSupportingCount}$2`
    )

    // Replace "- Confidence: X.XX" in this section
    updated = updated.replace(
      /^([-\s]*Confidence:\s*)[\d.]+/im,
      `$1${newConfidence.toFixed(2)}`
    )

    return updated
  })

  writeFileSync(lessonsPath, updatedParts.join(''), 'utf8')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run experience distillation.
 * Reads reflection/mistakes.md, groups entries by pattern,
 * and writes strategy rules to reflection/lessons.md when a pattern
 * accumulates 5+ entries.
 *
 * @param reflectionDir - Path to the reflection/ directory
 * @returns Summary of newly created and updated strategy rules
 */
export function distillExperiences(reflectionDir: string): ExperienceDistillResult {
  mkdirSync(reflectionDir, { recursive: true })

  const mistakesPath = join(reflectionDir, 'mistakes.md')
  const lessonsPath = join(reflectionDir, 'lessons.md')

  const result: ExperienceDistillResult = {
    newRules: 0,
    updatedRules: 0,
    totalStrategies: 0,
  }

  // Nothing to distill if no mistakes file
  if (!existsSync(mistakesPath)) return result

  const mistakesContent = readFileSync(mistakesPath, 'utf8')
  const entries = parseMistakes(mistakesContent)

  if (entries.length === 0) return result

  // Group by pattern
  const groups = groupByPattern(entries)

  // Load existing strategies from lessons.md
  const lessonsContent = existsSync(lessonsPath) ? readFileSync(lessonsPath, 'utf8') : ''
  const existingStrategies = parseExistingStrategies(lessonsContent)

  for (const group of groups) {
    if (group.count < 5) continue // Below distillation threshold

    // Check if a strategy already exists for this pattern
    const existing = existingStrategies.find(s => s.pattern === group.pattern)

    if (!existing) {
      // Generate new strategy
      const id = nextStrategyId(existsSync(lessonsPath) ? readFileSync(lessonsPath, 'utf8') : '')
      appendStrategy(lessonsPath, group, id)
      result.newRules++
    } else if (group.count > existing.supportingCount) {
      // Update existing strategy
      updateStrategy(lessonsPath, existing, group.count)
      result.updatedRules++
    }
  }

  // Count total strategies after all writes
  const finalContent = existsSync(lessonsPath) ? readFileSync(lessonsPath, 'utf8') : ''
  result.totalStrategies = countStrategies(finalContent)

  return result
}
