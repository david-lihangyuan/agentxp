/**
 * trace-evaluator.ts — Long traces with errors → mark high-value.
 *
 * Identifies sessions with 3+ steps that include errors,
 * indicating complex problem-solving that produced valuable learning.
 */

import type { Db } from '../db.js'
import type { PluginConfig } from '../types.js'
import type { PluginLogger } from './types.js'

export interface EvaluatedTrace {
  sessionId: string
  stepCount: number
  hasErrors: boolean
  highValue: boolean
}

export async function runTraceEvaluator(
  db: Db,
  _config: PluginConfig,
  logger: PluginLogger,
): Promise<EvaluatedTrace[]> {
  const sessions = db.listTraceSessions()
  const evaluated: EvaluatedTrace[] = []

  for (const session of sessions) {
    const highValue = session.stepCount >= 3 && session.hasErrors

    evaluated.push({
      sessionId: session.sessionId,
      stepCount: session.stepCount,
      hasErrors: session.hasErrors,
      highValue,
    })

    if (highValue) {
      logger.info(
        `[agentxp/trace-evaluator] high-value trace: ${session.sessionId} ` +
        `(${session.stepCount} steps, has errors)`,
      )
    }
  }

  if (evaluated.length === 0) {
    logger.debug('[agentxp/trace-evaluator] no traces to evaluate')
  }

  return evaluated
}
