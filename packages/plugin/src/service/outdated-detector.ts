/**
 * outdated-detector.ts — 3+ contradicted feedback → mark lesson outdated.
 *
 * Scans lessons that have accumulated enough contradicted feedback
 * and marks them as outdated so they're no longer injected.
 */

import type { Db } from '../db.js'
import type { PluginLogger } from './types.js'

export async function runOutdatedDetector(db: Db, logger: PluginLogger): Promise<void> {
  const candidates = db.listLessonsWithContradictions(3)

  if (candidates.length === 0) {
    logger.debug('[agentxp/outdated-detector] no lessons with 3+ contradictions')
    return
  }

  for (const { lessonId, contradictionCount } of candidates) {
    db.markOutdated(lessonId)
    logger.info(`[agentxp/outdated-detector] marked lesson ${lessonId} outdated (${contradictionCount} contradictions)`)
  }
}
