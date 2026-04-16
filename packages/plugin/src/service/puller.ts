/**
 * puller.ts — GET relay → sanitize → insert local.
 *
 * Pulls lessons from the network relay and inserts them locally.
 * Uses _fetchFn for test injection.
 */

import type { Db } from '../db.js'
import type { PluginConfig } from '../types.js'
import type { PluginLogger } from './types.js'
import { sanitizeBeforePublish } from '../sanitize.js'

export type FetchFn = typeof globalThis.fetch

interface RelayLesson {
  what: string
  tried: string
  outcome: string
  learned: string
  tags?: string[]
}

export async function runPuller(
  db: Db,
  config: PluginConfig,
  logger: PluginLogger,
  _fetchFn: FetchFn = globalThis.fetch,
): Promise<void> {
  try {
    const resp = await _fetchFn(`${config.relayUrl}/v1/lessons?limit=20`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    if (!resp.ok) {
      logger.warn(`[agentxp/puller] GET failed: ${resp.status}`)
      return
    }

    const data = (await resp.json()) as { lessons: RelayLesson[] }
    const lessons = data.lessons ?? []

    let inserted = 0
    for (const lesson of lessons) {
      // Sanitize before inserting
      const check = sanitizeBeforePublish(lesson)
      if (!check.safe) {
        logger.warn(`[agentxp/puller] rejected network lesson: ${check.reason}`)
        continue
      }

      db.insertLesson({
        what: lesson.what,
        tried: lesson.tried,
        outcome: lesson.outcome,
        learned: lesson.learned,
        source: 'network',
        tags: lesson.tags ?? [],
      })
      inserted++
    }

    if (inserted > 0) {
      logger.info(`[agentxp/puller] inserted ${inserted} network lessons`)
    } else {
      logger.debug('[agentxp/puller] no new lessons from relay')
    }
  } catch (err) {
    logger.error(`[agentxp/puller] error: ${err}`)
    throw err
  }
}
