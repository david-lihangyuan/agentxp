/**
 * feedback-loop.ts — GET relay feedback → update lesson scores.
 *
 * Fetches feedback from the relay for published lessons and updates local scores.
 * Uses _fetchFn for test injection.
 */

import type { Db } from '../db.js'
import type { PluginConfig } from '../types.js'
import type { PluginLogger } from './types.js'

export type FetchFn = typeof globalThis.fetch

interface RelayFeedback {
  lessonId: number
  type: 'cited' | 'verified' | 'contradicted' | 'outdated'
  comment?: string
}

export async function runFeedbackLoop(
  db: Db,
  config: PluginConfig,
  logger: PluginLogger,
  _fetchFn: FetchFn = globalThis.fetch,
): Promise<void> {
  try {
    const resp = await _fetchFn(`${config.relayUrl}/v1/feedback`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    if (!resp.ok) {
      logger.warn(`[agentxp/feedback-loop] GET failed: ${resp.status}`)
      return
    }

    const data = (await resp.json()) as { feedback: RelayFeedback[] }
    const feedbackItems = data.feedback ?? []

    let processed = 0
    for (const fb of feedbackItems) {
      // Insert feedback record
      db.insertFeedback({
        lessonId: fb.lessonId,
        type: fb.type,
        comment: fb.comment,
      })

      // Update relevance score based on feedback type
      const lesson = db.getLesson(fb.lessonId)
      if (lesson) {
        const scoreDelta =
          fb.type === 'verified' ? 0.1 :
          fb.type === 'cited' ? 0.05 :
          fb.type === 'contradicted' ? -0.2 :
          fb.type === 'outdated' ? -0.3 :
          0

        const newScore = Math.max(0, Math.min(1, (lesson.relevanceScore ?? 0) + scoreDelta))
        db.updateLessonRelevanceScore(fb.lessonId, newScore)
      }

      processed++
    }

    if (processed > 0) {
      logger.info(`[agentxp/feedback-loop] processed ${processed} feedback items`)
    } else {
      logger.debug('[agentxp/feedback-loop] no new feedback')
    }
  } catch (err) {
    logger.error(`[agentxp/feedback-loop] error: ${err}`)
    throw err
  }
}
