// Proactive Recall — Pattern-match current task against local reflection files
// Runs at task-start hook, surfaces relevant past mistakes/lessons before execution.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

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

/**
 * Proactive recall: search local reflection files for entries matching a task description.
 * Returns matching entries sorted by relevance score (highest first).
 *
 * @param taskDescription - What the agent is about to do
 * @param reflectionDir - Path to the reflection/ directory
 */
export async function proactiveRecall(
  taskDescription: string,
  reflectionDir?: string
): Promise<RecallMatch[]> {
  const dir = reflectionDir || join(process.cwd(), 'reflection')
  const keywords = extractKeywords(taskDescription)

  if (keywords.length === 0) {
    return []
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

  return allMatches
}
