/**
 * publisher.ts — Sanitize → sign → POST to relay.
 *
 * Publishes unpublished lessons to the network relay.
 * Uses _fetchFn for test injection.
 */

import type { Db, Lesson } from '../db.js'
import type { PluginConfig } from '../types.js'
import type { PluginLogger } from './types.js'
import { sanitizeBeforePublish } from '../sanitize.js'

export type FetchFn = typeof globalThis.fetch

export async function runPublisher(
  db: Db,
  config: PluginConfig,
  logger: PluginLogger,
  _fetchFn: FetchFn = globalThis.fetch,
): Promise<void> {
  const lessons = db.listUnpublishedLessons()
  if (lessons.length === 0) {
    logger.debug('[agentxp/publisher] no unpublished lessons')
    return
  }

  let published = 0
  for (const lesson of lessons) {
    const check = sanitizeBeforePublish(lesson)
    if (!check.safe) {
      logger.warn(`[agentxp/publisher] lesson ${lesson.id} failed sanitize: ${check.reason}`)
      continue
    }

    // POST to relay with retry (up to 3 attempts)
    let success = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await _fetchFn(`${config.relayUrl}/v1/lessons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            what: lesson.what,
            tried: lesson.tried,
            outcome: lesson.outcome,
            learned: lesson.learned,
            tags: lesson.tags,
          }),
        })

        if (resp.ok) {
          const data = (await resp.json()) as { eventId?: string }
          db.insertPublishedLog({
            lessonId: lesson.id!,
            relayEventId: data.eventId,
          })
          published++
          success = true
          break
        } else {
          logger.warn(`[agentxp/publisher] POST failed (attempt ${attempt}): ${resp.status}`)
        }
      } catch (err) {
        logger.warn(`[agentxp/publisher] POST error (attempt ${attempt}): ${err}`)
      }
    }

    if (!success) {
      logger.error(`[agentxp/publisher] failed to publish lesson ${lesson.id} after 3 attempts`)
    }
  }

  if (published > 0) {
    logger.info(`[agentxp/publisher] published ${published} lessons`)
  }
}
