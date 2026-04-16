/**
 * tools/publish.ts — agentxp_publish optional tool.
 *
 * Allows the agent to manually publish a learned experience to the database.
 */

import type { Db } from '../db.js'
import { qualityGate } from '../extraction-engine.js'
import { sanitizeBeforeStore } from '../sanitize.js'

export interface PublishParams {
  what: string
  tried: string
  outcome: string
  learned: string
  context?: string
}

export interface AgentXpPublishTool {
  name: 'agentxp_publish'
  description: string
  parameters: {
    type: 'object'
    properties: {
      what: { type: 'string'; description: string }
      tried: { type: 'string'; description: string }
      outcome: { type: 'string'; description: string }
      learned: { type: 'string'; description: string }
      context: { type: 'string'; description: string }
    }
    required: ['what', 'tried', 'outcome', 'learned']
  }
  execute: (params: PublishParams) => Promise<string>
}

export function createPublishTool(db: Db): AgentXpPublishTool {
  return {
    name: 'agentxp_publish',
    description: 'Publish a learned experience to the AgentXP database',
    parameters: {
      type: 'object' as const,
      properties: {
        what: {
          type: 'string' as const,
          description: 'What problem was encountered',
        },
        tried: {
          type: 'string' as const,
          description: 'What was tried',
        },
        outcome: {
          type: 'string' as const,
          description: 'What happened',
        },
        learned: {
          type: 'string' as const,
          description: 'What was learned',
        },
        context: {
          type: 'string' as const,
          description: 'Additional context (optional)',
        },
      },
      required: ['what', 'tried', 'outcome', 'learned'] as const,
    },
    async execute({ what, tried, outcome, learned, context }: PublishParams) {
      if (!qualityGate({ what, tried, outcome, learned })) {
        return 'Experience did not pass quality gate. Ensure "learned" is specific and >= 20 chars with a technical reference.'
      }

      const sanitized = sanitizeBeforeStore({ what, tried, outcome, learned })
      const tags = context ? ['manual', context] : ['manual']
      db.insertLesson({
        ...sanitized,
        source: 'local',
        tags,
      })

      return 'Experience saved successfully.'
    },
  }
}
