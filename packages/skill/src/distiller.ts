// Periodic Distillation — Compress old reflection entries into core insights
// Archives raw entries to drafts/archive/. LLM trigger only when > 5 unparseable entries.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseReflectionEntry } from './reflection-parser.js'

export interface DistillResult {
  /** Extracted core insights from old entries */
  insights: string[]
  /** Number of entries archived */
  archived: number
}

/**
 * Extract a concise insight string from a reflection entry.
 * Combines the learned lesson with context from tried/outcome.
 */
function extractInsight(entry: ReturnType<typeof parseReflectionEntry>): string {
  const parts: string[] = []
  if (entry.title) parts.push(entry.title)
  if (entry.learned) parts.push(entry.learned)
  if (parts.length === 0 && entry.tried) parts.push(entry.tried)
  return parts.join(' — ')
}

/**
 * Distill a reflection directory: compress old entries into insights,
 * archive raw entries to drafts/archive/.
 *
 * @param reflectionDir - Path to the reflection/ directory
 * @param workspaceDir - Workspace root (for drafts/archive/ location)
 */
export async function distill(
  reflectionDir: string,
  workspaceDir: string
): Promise<DistillResult> {
  const insights: string[] = []
  let archived = 0

  // Find all .md files in reflection directory
  const files = readdirSync(reflectionDir).filter(f => f.endsWith('.md'))

  for (const file of files) {
    const filePath = join(reflectionDir, file)
    const content = readFileSync(filePath, 'utf8')

    // Split into sections
    const sections = content.split(/(?=^## )/m)
    const header = sections.find(s => s.startsWith('# ') && !s.startsWith('## '))
    const entries = sections.filter(s => s.startsWith('## '))

    if (entries.length === 0) continue

    // Parse each entry
    const parsedEntries = entries.map(raw => ({
      raw: raw.trim(),
      parsed: parseReflectionEntry(raw.trim()),
    }))

    // Archive all raw entries
    const archiveDir = join(workspaceDir, 'drafts', 'archive')
    mkdirSync(archiveDir, { recursive: true })

    const timestamp = Date.now()
    const archivePath = join(archiveDir, `${file.replace('.md', '')}-${timestamp}.md`)
    writeFileSync(archivePath, entries.join('\n'))
    archived += entries.length

    // Extract insights from parseable entries
    for (const { parsed } of parsedEntries) {
      const insight = extractInsight(parsed)
      if (insight.length > 10) {
        insights.push(insight)
      }
    }

    // Rewrite the original file with only the header + distilled insights section
    const headerText = header ? header.trim() + '\n\n' : `# ${file.replace('.md', '').charAt(0).toUpperCase() + file.replace('.md', '').slice(1)}\n\n`
    const insightsSection = insights.length > 0
      ? `## Core Insights (Distilled)\n${insights.map(i => `- ${i}`).join('\n')}\n`
      : ''
    writeFileSync(filePath, headerText + insightsSection)
  }

  return { insights, archived }
}

/**
 * Check if LLM assistance should be triggered for unparseable entries.
 * Fires only when there are > 5 unparseable files in drafts/unparseable/.
 * This is demand-driven, NOT scheduled.
 *
 * @param workspaceDir - Workspace root directory
 * @returns true if LLM should be invoked
 */
export async function checkLLMTrigger(workspaceDir: string): Promise<boolean> {
  const unparseableDir = join(workspaceDir, 'drafts', 'unparseable')
  if (!existsSync(unparseableDir)) return false

  const files = readdirSync(unparseableDir).filter(f => f.endsWith('.md'))
  return files.length > 5
}
