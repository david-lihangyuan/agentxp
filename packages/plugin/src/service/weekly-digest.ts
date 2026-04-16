/**
 * weekly-digest.ts — Stats summary → formatted string.
 *
 * Aggregates weekly stats (lessons, injections, traces) and
 * returns a formatted digest string.
 */

import type { Db } from '../db.js'
import type { PluginConfig } from '../types.js'
import type { PluginLogger } from './types.js'

export interface DigestStats {
  totalLessons: number
  newLessons: number
  totalInjections: number
  successfulInjections: number
  totalTraceSteps: number
  traceSessions: number
  highValueTraces: number
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function gatherStats(db: Db): DigestStats {
  const totalLessons = db.getLessonCount()
  const newLessons = db.getNewLessonCount(ONE_WEEK_MS)
  const injectionStats = db.getInjectionStats(ONE_WEEK_MS)
  const traceSteps = db.getTraceStepCount()
  const sessions = db.listTraceSessions()
  const highValue = sessions.filter(s => s.stepCount >= 3 && s.hasErrors)

  return {
    totalLessons,
    newLessons,
    totalInjections: injectionStats.total,
    successfulInjections: injectionStats.injected,
    totalTraceSteps: traceSteps,
    traceSessions: sessions.length,
    highValueTraces: highValue.length,
  }
}

export function formatDigest(stats: DigestStats): string {
  const lines = [
    '# AgentXP Weekly Digest',
    '',
    `**Period**: ${new Date(Date.now() - ONE_WEEK_MS).toISOString().slice(0, 10)} — ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Lessons',
    `- Total active: ${stats.totalLessons}`,
    `- New this week: ${stats.newLessons}`,
    '',
    '## Injections',
    `- Total: ${stats.totalInjections}`,
    `- Successful: ${stats.successfulInjections}`,
    '',
    '## Traces',
    `- Total steps: ${stats.totalTraceSteps}`,
    `- Sessions: ${stats.traceSessions}`,
    `- High-value: ${stats.highValueTraces}`,
    '',
  ]
  return lines.join('\n')
}

export async function runWeeklyDigest(
  db: Db,
  _config: PluginConfig,
  logger: PluginLogger,
): Promise<string> {
  const stats = gatherStats(db)
  const digest = formatDigest(stats)

  logger.info(`[agentxp/weekly-digest] generated digest: ${stats.totalLessons} lessons, ${stats.newLessons} new`)
  return digest
}
