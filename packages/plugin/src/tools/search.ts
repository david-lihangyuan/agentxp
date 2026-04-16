/**
 * tools/search.ts — agentxp_search optional tool.
 *
 * Allows the agent to search the AgentXP experience database on demand.
 */

import type { Db, Lesson } from '../db.js'

export interface AgentXpSearchTool {
  name: 'agentxp_search'
  description: string
  parameters: {
    type: 'object'
    properties: {
      query: { type: 'string'; description: string }
      limit: { type: 'number'; description: string }
    }
    required: ['query']
  }
  execute: (params: { query: string; limit?: number }) => Promise<string>
}

function formatLessons(lessons: Lesson[]): string {
  return lessons
    .map(
      (l) =>
        `[#${l.id}] ${l.what}\n  Tried: ${l.tried}\n  Learned: ${l.learned}`,
    )
    .join('\n\n')
}

export function createSearchTool(db: Db): AgentXpSearchTool {
  return {
    name: 'agentxp_search',
    description:
      'Search AgentXP experience database for relevant lessons from past problem-solving',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query' },
        limit: {
          type: 'number' as const,
          description: 'Max results (default 5)',
        },
      },
      required: ['query'] as const,
    },
    async execute({ query, limit = 5 }: { query: string; limit?: number }) {
      const lessons = db.searchLessons(query, limit)
      if (lessons.length === 0) return 'No matching experiences found.'
      return formatLessons(lessons)
    },
  }
}
