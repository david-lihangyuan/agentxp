/**
 * distiller.ts — Periodic reflection distillation (§5.5)
 *
 * Rule-based distillation: groups reflections by tags + category,
 * merges 3+ entries into a single distilled insight.
 * No LLM calls (local plugin constraint).
 */

import type { Db } from '../db.js'

export interface DistillResult {
  distilledCount: number
}

export interface DistillOptions {
  minGroupSize?: number
  dryRun?: boolean
}

/**
 * Distill accumulated reflections into core insights.
 * Groups by (category, tags), merges 3+ entries into one distilled record.
 * Deduplicates: reflections already used as source_ids are not re-distilled.
 */
export async function distill(db: Db, opts: DistillOptions = {}): Promise<DistillResult> {
  const minGroupSize = opts.minGroupSize ?? 3
  const dryRun = opts.dryRun ?? false

  // Get all reflections eligible for distillation
  // Exclude: already used as sources, or not in mistake/lesson categories
  const reflections = db.db.prepare(`
    SELECT r.* FROM reflections r
    WHERE r.category IN ('mistake', 'lesson')
      AND r.id NOT IN (
        SELECT json_each.value
        FROM distilled, json_each(distilled.source_ids)
      )
    ORDER BY r.created_at ASC
  `).all() as any[]

  if (reflections.length === 0) {
    return { distilledCount: 0 }
  }

  // Group by (category, normalized_tags)
  type GroupKey = string
  const groups = new Map<GroupKey, any[]>()

  for (const r of reflections) {
    const tags = r.tags ? JSON.parse(r.tags) : []
    const normalizedTags = tags.sort().join(',')
    const key = `${r.category}:${normalizedTags}`
    
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(r)
  }

  // Distill groups with >= minGroupSize entries
  let distilledCount = 0
  const now = Date.now()

  for (const [groupKey, groupReflections] of groups.entries()) {
    if (groupReflections.length < minGroupSize) continue

    // Extract category from key
    const category = groupKey.split(':')[0] as 'mistake' | 'lesson'

    // Generate distilled title and summary
    const titles = groupReflections.map(r => r.title)
    const title = `Recurring pattern: ${titles[0]}` // Simple heuristic
    const summary = `Distilled from ${groupReflections.length} related ${category} entries: ${titles.join('; ')}`

    // Source IDs
    const sourceIds = JSON.stringify(groupReflections.map(r => r.id))

    // Confidence based on group size
    const confidence = Math.min(1.0, groupReflections.length / 10)

    if (!dryRun) {
      (db.insertDistilled as any).run(
        category,
        title,
        summary,
        sourceIds,
        confidence,
        0, // applied_count
        0, // success_count
        now,
        now,
      )
    }

    distilledCount++
  }

  return { distilledCount }
}
