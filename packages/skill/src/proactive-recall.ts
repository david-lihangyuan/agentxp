// Proactive Recall — Pattern-match current task against local reflection files
// Runs at task-start hook, surfaces relevant past mistakes/lessons before execution.
// Optionally searches the relay for external experiences from the network.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { relayRecall } from './relay-recall.js'
import type { RecallResult } from './relay-recall.js'

export interface RecallMatch {
  file: string
  content: string
  title: string
  score: number
}

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

export interface ProactiveRecallOptions {
  /** Path to the reflection/ directory */
  reflectionDir?: string
  /** Relay URL — if provided, also searches the relay for external experiences */
  relayUrl?: string
  /** Agent home directory for loading operator pubkey (to exclude own experiences) */
  agentHomeDir?: string
}

export interface ProactiveRecallResult {
  /** Local matches from reflection files */
  local: RecallMatch[]
  /** Formatted relay results (wrapped in <external_experience> tags), or null if relay not used */
  relay: string | null
}

/**
 * Proactive recall: search local reflection files for entries matching a task description.
 * Returns matching entries sorted by relevance score (highest first).
 * Optionally also searches the relay for external experiences.
 *
 * @param taskDescription - What the agent is about to do
 * @param options - Reflection dir, relay URL, etc. (string for backward compat = reflectionDir)
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

  // Sort by score descending
  allMatches.sort((a, b) => b.score - a.score)

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

    return { local: allMatches, relay: relayFormatted } as any
  }

  return allMatches
}
