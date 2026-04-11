// Local Experience Search — Two-layer keyword search over reflection/ files
// Zero network required. Summary first (low token cost), full content on demand.

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

export interface SearchResultSummary {
  /** Unique identifier for expand-on-demand */
  id: string
  /** Entry title from heading */
  title: string
  /** Outcome field (succeeded/failed/partial) */
  outcome?: string
  /** Tags from the entry */
  tags?: string[]
  /** Which reflection file this came from */
  file: string
  /** Relevance score */
  score: number
  /** Full content — only present when expand matches or full=true */
  fullContent?: string
  /** Alias for fullContent (snake_case) — only present when expand matches */
  full_content?: string
}

export interface SearchOptions {
  /** Return full content for all results */
  full?: boolean
  /** Expand a specific result by ID */
  expand?: string
}



/** Common stop words to filter from queries */
const STOP_WORDS = new Set([
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
  'write', 'make', 'get', 'let', 'also',
])

/**
 * Extract keywords from a query string.
 * Removes stop words and returns unique lowercase tokens.
 */
function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
}

/**
 * Parse a reflection file into entries.
 * Each entry starts with ## heading.
 */
function parseEntries(content: string, fileName: string): Array<{
  title: string
  body: string
  outcome?: string
  tags?: string[]
  file: string
}> {
  const entries: Array<{
    title: string
    body: string
    outcome?: string
    tags?: string[]
    file: string
  }> = []

  const sections = content.split(/(?=^## )/m)

  for (const section of sections) {
    if (!section.startsWith('## ')) continue

    const lines = section.split('\n')
    const titleLine = lines[0]?.replace(/^## /, '').trim() || ''
    const body = lines.slice(1).join('\n').trim()

    // Extract outcome
    const outcomeMatch = body.match(/^- Outcome:\s*(.+)$/m)
    const outcome = outcomeMatch ? outcomeMatch[1].trim() : undefined

    // Extract tags
    const tagsMatch = body.match(/^- Tags:\s*(.+)$/m)
    const tags = tagsMatch
      ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
      : undefined

    if (titleLine) {
      entries.push({ title: titleLine, body, outcome, tags, file: fileName })
    }
  }

  return entries
}

/**
 * Generate a stable ID for an entry based on file + title.
 */
function generateId(file: string, title: string): string {
  const hash = createHash('sha256')
    .update(`${file}:${title}`)
    .digest('hex')
    .slice(0, 12)
  return hash
}

/**
 * Score an entry against keywords.
 */
function scoreEntry(
  entry: { title: string; body: string; tags?: string[] },
  keywords: string[]
): number {
  const titleLower = entry.title.toLowerCase()
  const bodyLower = entry.body.toLowerCase()
  const tagText = (entry.tags || []).join(' ').toLowerCase()

  let score = 0
  for (const keyword of keywords) {
    if (titleLower.includes(keyword)) score += 2
    if (bodyLower.includes(keyword)) score += 1
    if (tagText.includes(keyword)) score += 1.5
  }
  return score
}

/**
 * Search local reflection files for entries matching a keyword query.
 * Returns two-layer results: summary first, full content only when options.full = true.
 *
 * @param query - Search query string
 * @param reflectionDir - Path to the reflection/ directory
 * @param options - Search options (full: include full content)
 */
export { search as localSearch }

export async function search(
  query: string,
  reflectionDir: string,
  options?: SearchOptions
): Promise<SearchResultSummary[]> {
  const keywords = extractKeywords(query)
  if (keywords.length === 0) return []

  if (!existsSync(reflectionDir)) return []

  const files = readdirSync(reflectionDir).filter(f => f.endsWith('.md'))
  const results: SearchResultSummary[] = []

  for (const file of files) {
    const filePath = join(reflectionDir, file)
    const content = readFileSync(filePath, 'utf8')
    const entries = parseEntries(content, file)

    for (const entry of entries) {
      const score = scoreEntry(entry, keywords)
      if (score > 0) {
        const result: SearchResultSummary = {
          id: generateId(file, entry.title),
          title: entry.title,
          outcome: entry.outcome,
          tags: entry.tags,
          file: entry.file,
          score,
        }

        if (options?.full || (options?.expand && result.id === options.expand)) {
          result.fullContent = entry.body
          result.full_content = entry.body
        }

        results.push(result)
      }
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)

  return results
}
