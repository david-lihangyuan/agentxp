/**
 * memory-corpus.ts — MemoryCorpusSupplement for AgentXP.
 *
 * Exposes AgentXP lessons through the OpenClaw Memory Corpus interface,
 * enabling `memory_search(corpus='all')` to include AgentXP experiences.
 */

import type { Db, Lesson } from './db.js'
import type { PluginConfig } from './types.js'

// ─── SDK-compatible types (defined locally to avoid hard import) ────────────

export interface MemoryCorpusSearchResult {
  corpus: string
  path: string
  title?: string
  kind?: string
  score: number
  snippet: string
  id?: string
  startLine?: number
  endLine?: number
  citation?: string
  source?: string
  provenanceLabel?: string
  sourceType?: string
}

export interface MemoryCorpusGetResult {
  corpus: string
  path: string
  title?: string
  kind?: string
  content: string
  fromLine: number
  lineCount: number
  id?: string
  provenanceLabel?: string
  sourceType?: string
}

export interface MemoryCorpusSupplement {
  search(params: {
    query: string
    maxResults?: number
    agentSessionKey?: string
  }): Promise<MemoryCorpusSearchResult[]>

  get(params: {
    lookup: string
    fromLine?: number
    lineCount?: number
    agentSessionKey?: string
  }): Promise<MemoryCorpusGetResult | null>
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createCorpusSupplement(
  db: Db,
  _config: PluginConfig,
): MemoryCorpusSupplement {
  return {
    async search({ query, maxResults }) {
      const limit = maxResults ?? 5
      const lessons = db.searchLessons(query, limit)

      return lessons.map((lesson, i): MemoryCorpusSearchResult => ({
        corpus: 'agentxp',
        path: `agentxp://lesson/${lesson.id}`,
        title: lesson.what,
        kind: 'experience',
        score: 1.0 - i * 0.1,
        snippet: `Tried: ${lesson.tried}\nLearned: ${lesson.learned}`,
        id: String(lesson.id),
        citation: `[AgentXP #${lesson.id}]`,
        source: lesson.source,
        provenanceLabel: 'AgentXP',
        sourceType: 'plugin',
      }))
    },

    async get({ lookup }) {
      // lookup = "agentxp://lesson/123" or just "123"
      const id = parseInt(lookup.replace(/^agentxp:\/\/lesson\//, ''), 10)
      if (isNaN(id)) return null

      const lesson = db.getLesson(id)
      if (!lesson) return null

      const content = [
        `## ${lesson.what}`,
        '',
        `**Tried:** ${lesson.tried}`,
        `**Outcome:** ${lesson.outcome}`,
        `**Learned:** ${lesson.learned}`,
        '',
        `Source: ${lesson.source} | Created: ${new Date(lesson.createdAt ?? 0).toISOString()}`,
        lesson.tags && lesson.tags.length > 0
          ? `Tags: ${lesson.tags.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')

      return {
        corpus: 'agentxp',
        path: `agentxp://lesson/${lesson.id}`,
        title: lesson.what,
        kind: 'experience',
        content,
        fromLine: 1,
        lineCount: content.split('\n').length,
        id: String(lesson.id),
        provenanceLabel: 'AgentXP',
        sourceType: 'plugin',
      }
    },
  }
}
