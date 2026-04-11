// Rule-Based Reflection Parser — Extract structured data from reflection entries
// Quality gate: ensures entries have enough substance before marking publishable.
// Unparseable entries are routed to drafts/unparseable/.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join, basename } from 'path'

export interface ParsedReflection {
  /** Date from the entry heading */
  date?: string
  /** Title from the entry heading */
  title?: string
  /** What was tried (from "- Tried:" line) */
  tried?: string
  /** Expected outcome (from "- Expected:" line) */
  expected?: string
  /** Actual outcome (from "- Outcome:" line) */
  outcome?: string
  /** Lesson learned (from "- Learned:" line) */
  learned?: string
  /** Tags (from "- Tags:" line) */
  tags?: string[]
  /** Whether this entry passes the quality gate */
  publishable: boolean
  /** Reason for rejection if not publishable */
  reason?: string
  /** The raw entry text */
  raw: string
}

/** Minimum character count for tried and learned fields */
const MIN_FIELD_LENGTH = 20

/** Words that indicate vagueness / lack of specifics */
const VAGUE_INDICATORS = [
  'some approach',
  'did stuff',
  'be careful',
  'be more careful',
  'sometimes works and sometimes doesn\'t',
  'try harder',
  'do better',
  'something',
  'some thing',
  'I tried yesterday',
]

/** Words that indicate specifics (commands, filenames, error codes, config keys) */
const SPECIFIC_INDICATORS = [
  /\b\w+\.\w{2,4}\b/,           // filenames (e.g., resolv.conf, app.ts)
  /\b[A-Z_]{3,}\b/,             // constants/env vars (e.g., DNS, API_KEY)
  /\b\d{3,}\b/,                 // error codes, port numbers
  /\/[\w/.-]+/,                  // file paths (e.g., /etc/resolv.conf)
  /\b(docker|npm|git|curl|bun|pip|apt|brew|kubectl)\b/i,  // commands
  /\b(config|restart|install|deploy|migrate|build)\b/i,    // action verbs
  /\berror\b/i,                  // error mentions
  /\bfailed?\b/i,               // failure mentions
]

/**
 * Parse a single reflection entry from its raw text.
 * Extracts tried/expected/outcome/learned/tags and applies the quality gate.
 */
export function parseReflectionEntry(raw: string): ParsedReflection {
  const result: ParsedReflection = {
    publishable: false,
    raw,
  }

  // Extract heading: ## [DATE] [TITLE]
  const headingMatch = raw.match(/^## (\d{4}-\d{2}-\d{2})\s+(.+?)$/m)
  if (headingMatch) {
    result.date = headingMatch[1]
    result.title = headingMatch[2].trim()
  }

  // Extract fields
  const triedMatch = raw.match(/^- Tried:\s*(.+)$/m)
  if (triedMatch) result.tried = triedMatch[1].trim()

  const expectedMatch = raw.match(/^- Expected:\s*(.+)$/m)
  if (expectedMatch) result.expected = expectedMatch[1].trim()

  const outcomeMatch = raw.match(/^- Outcome:\s*(.+)$/m)
  if (outcomeMatch) result.outcome = outcomeMatch[1].trim()

  const learnedMatch = raw.match(/^- Learned:\s*(.+)$/m)
  if (learnedMatch) result.learned = learnedMatch[1].trim()

  const tagsMatch = raw.match(/^- Tags:\s*(.+)$/m)
  if (tagsMatch) {
    result.tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
  }

  // Quality gate
  // Check 1: Required fields must exist
  if (!result.tried || !result.outcome || !result.learned) {
    result.reason = 'missing required fields (tried, outcome, learned)'
    return result
  }

  // Check 2: Minimum length for tried and learned
  if (result.tried.length < MIN_FIELD_LENGTH || result.learned.length < MIN_FIELD_LENGTH) {
    result.reason = 'too short: tried and learned must each be > 20 characters'
    return result
  }

  // Check 3: Check for vagueness
  const combinedText = `${result.tried} ${result.learned}`.toLowerCase()
  const isVague = VAGUE_INDICATORS.some(indicator => combinedText.includes(indicator.toLowerCase()))
  if (isVague) {
    result.reason = 'no specifics: entry is too vague to be useful'
    return result
  }

  // Check 4: Must contain at least one specific indicator
  const hasSpecifics = SPECIFIC_INDICATORS.some(pattern => pattern.test(combinedText))
  if (!hasSpecifics) {
    result.reason = 'no specifics: needs commands, filenames, error codes, or config keys'
    return result
  }

  // Passes quality gate
  result.publishable = true
  return result
}

/**
 * Process a reflection file, parsing all entries.
 * Unparseable entries are moved to drafts/unparseable/.
 *
 * @param filePath - Path to the reflection file (e.g., reflection/mistakes.md)
 * @param workspaceDir - Workspace root directory (for drafts/unparseable/ location)
 * @returns Array of parsed entries
 */
export async function processReflectionFile(
  filePath: string,
  workspaceDir?: string
): Promise<ParsedReflection[]> {
  if (!existsSync(filePath)) return []

  const content = readFileSync(filePath, 'utf8')
  const sections = content.split(/(?=^## )/m).filter(s => s.trim())
  const results: ParsedReflection[] = []
  const unparseableEntries: string[] = []

  for (const section of sections) {
    // Skip the file header (# Mistakes, etc.)
    if (section.startsWith('# ') && !section.startsWith('## ')) continue

    const parsed = parseReflectionEntry(section.trim())
    results.push(parsed)

    if (!parsed.publishable) {
      unparseableEntries.push(section.trim())
    }
  }

  // Write unparseable entries to drafts/unparseable/
  if (unparseableEntries.length > 0) {
    const workspace = workspaceDir || join(filePath, '..', '..')
    const unparseableDir = join(workspace, 'drafts', 'unparseable')
    mkdirSync(unparseableDir, { recursive: true })

    const fileName = basename(filePath, '.md')
    const timestamp = Date.now()
    const outPath = join(unparseableDir, `${fileName}-${timestamp}.md`)
    writeFileSync(outPath, unparseableEntries.join('\n\n'))
  }

  return results
}
