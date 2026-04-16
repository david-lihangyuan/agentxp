/**
 * distiller.ts — Merge 5+ similar lessons into a strategy rule.
 *
 * Scans lessons grouped by tag. When a group reaches the threshold,
 * merges them into one consolidated lesson and marks originals outdated.
 */

import type { Db } from '../db.js'
import type { PluginLogger } from './types.js'

export async function runDistiller(db: Db, logger: PluginLogger): Promise<void> {
  const groups = db.listLessonsForDistillation(5)

  if (groups.length === 0) {
    logger.debug('[agentxp/distiller] no groups ready for distillation')
    return
  }

  for (const group of groups) {
    const { tag, lessons } = group

    // Merge learned fields into a single strategy rule
    const mergedWhat = `[strategy] ${tag}: consolidated from ${lessons.length} lessons`
    const mergedTried = lessons.map(l => l.tried).join(' | ')
    const mergedOutcome = lessons.map(l => l.outcome).join(' | ')
    const mergedLearned = lessons
      .map(l => l.learned)
      .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
      .join('; ')

    // Collect all unique tags from originals
    const allTags = [...new Set(lessons.flatMap(l => l.tags ?? []))]

    // Insert merged lesson
    db.insertLesson({
      what: mergedWhat,
      tried: mergedTried,
      outcome: mergedOutcome,
      learned: mergedLearned,
      source: 'local',
      tags: allTags,
    })

    // Mark originals as outdated
    for (const lesson of lessons) {
      if (lesson.id != null) {
        db.markOutdated(lesson.id)
      }
    }

    logger.info(`[agentxp/distiller] merged ${lessons.length} lessons for tag "${tag}"`)
  }
}
