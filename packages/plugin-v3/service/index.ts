/**
 * service/index.ts — Service orchestrator (Phase 5)
 *
 * Runs the complete Evolve pipeline:
 * 1. Distillation (rule-based reflection merging)
 * 2. Milestone tracking (emotional milestones)
 * 3. Agent Speaks (repeated pattern detection)
 * 4. Impact scoring (feedback processing)
 * 5. Publisher (relay publishing with retry)
 *
 * Usage: Call tick() periodically (e.g., every 5 minutes via cron).
 */

import type { Db } from '../db.js'
import { distill } from './distiller.js'
import { checkMilestones } from './milestone-tracker.js'
import { detectRepeatedPatterns } from './agent-speaks.js'
import { processNewFeedback } from './scoring.js'
import { publishPending, type PluginConfig } from './publisher.js'
import { pullNetworkExperiences, type PullConfig } from './network-puller.js'

export interface ServiceOptions {
  config?: PluginConfig
  skipDistill?: boolean
  skipMilestones?: boolean
  skipAgentSpeaks?: boolean
  skipScoring?: boolean
  skipPublish?: boolean
}

export interface TickResult {
  distilled: number
  milestones: number
  alerts: number
  scored: number
  published: number
  retried: number
  blocked: number
  pulled: number
}

/**
 * Run all background services in sequence.
 * Returns a summary of operations performed.
 */
export async function tick(db: Db, opts: ServiceOptions = {}): Promise<TickResult> {
  const result: TickResult = {
    distilled: 0,
    milestones: 0,
    alerts: 0,
    scored: 0,
    published: 0,
    retried: 0,
    blocked: 0,
    pulled: 0,
  }

  // 1. Distillation
  if (!opts.skipDistill) {
    const distillResult = await distill(db)
    result.distilled = distillResult.distilledCount
  }

  // 2. Milestone tracking
  if (!opts.skipMilestones) {
    const milestones = await checkMilestones(db)
    result.milestones = milestones.length
  }

  // 3. Agent Speaks
  if (!opts.skipAgentSpeaks) {
    const alerts = await detectRepeatedPatterns(db)
    result.alerts = alerts.length

    // TODO: Deliver alerts to operator (requires messaging integration)
    // For now, alerts are just returned in the result
  }

  // 4. Impact scoring
  if (!opts.skipScoring) {
    const scored = await processNewFeedback(db)
    result.scored = scored.length
  }

  // 5. Publisher
  if (!opts.skipPublish && opts.config) {
    const publishResult = await publishPending(db, opts.config)
    result.published = publishResult.published
    result.retried = publishResult.retried
    result.blocked = publishResult.blocked
  }

  // 6. Network puller — pull experiences from other agents
  if (opts.config?.relayUrl && opts.config?.operatorPubkey) {
    const pullConfig: PullConfig = {
      relayUrl: opts.config.relayUrl,
      operatorPubkey: opts.config.operatorPubkey,
    }
    const pullResult = await pullNetworkExperiences(db, pullConfig)
    result.pulled = pullResult.imported
  }

  return result
}

// Re-export service functions for standalone use
export { distill } from './distiller.js'
export { checkMilestones } from './milestone-tracker.js'
export { detectRepeatedPatterns } from './agent-speaks.js'
export { computeImpactScore, processNewFeedback } from './scoring.js'
export { publishPending } from './publisher.js'
export type { PluginConfig } from './publisher.js'
