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
import { publishPending, pullPulseEvents, type PluginConfig } from './publisher.js'
import { pullNetworkExperiences, type PullConfig } from './network-puller.js'
import { runSearchPulse } from './search-pulse.js'
import { publishVerifications } from './verifier.js'

export interface ServiceOptions {
  config?: PluginConfig
  skipDistill?: boolean
  skipMilestones?: boolean
  skipAgentSpeaks?: boolean
  skipScoring?: boolean
  skipPublish?: boolean
  skipSearchPulse?: boolean
  skipVerifications?: boolean
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
  searched: number
  verified: number
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
    searched: 0,
    verified: 0,
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

  // 5. Publisher — outbound broadcast of reflections
  if (!opts.skipPublish && opts.config) {
    const publishResult = await publishPending(db, opts.config)
    result.published = publishResult.published
    result.retried = publishResult.retried
    result.blocked = publishResult.blocked
  }

  // 6. Search pulse — query relay on behalf of recent reflections so
  //    matching cross-operator experiences transition on the relay side.
  if (!opts.skipSearchPulse && opts.config?.relayUrl && opts.config?.operatorPubkey) {
    const sp = await runSearchPulse(db, {
      relayUrl: opts.config.relayUrl,
      operatorPubkey: opts.config.operatorPubkey,
    })
    result.searched = sp.searched
  }

  // 7. Verifier — reflect session outcomes back to authors of injected
  //    network experiences as signed verification events.
  if (!opts.skipVerifications && opts.config) {
    const vr = await publishVerifications(db, opts.config)
    result.verified = vr.published
  }

  // 8. Network puller — pull experiences from other agents
  if (opts.config?.relayUrl && opts.config?.operatorPubkey) {
    const pullConfig: PullConfig = {
      relayUrl: opts.config.relayUrl,
      operatorPubkey: opts.config.operatorPubkey,
    }
    const pullResult = await pullNetworkExperiences(db, pullConfig)
    result.pulled = pullResult.imported
  }

  // 9. Pulse pull — fold back all the state transitions that steps 5-7
  //    triggered on the relay (discovered / verified / propagating).
  if (opts.config) {
    await pullPulseEvents(db, opts.config)
  }

  return result
}

// Re-export service functions for standalone use
export { distill } from './distiller.js'
export { checkMilestones } from './milestone-tracker.js'
export { detectRepeatedPatterns } from './agent-speaks.js'
export { computeImpactScore, processNewFeedback } from './scoring.js'
export { publishPending, pullPulseEvents } from './publisher.js'
export { runSearchPulse } from './search-pulse.js'
export { publishVerifications, aggregateOutcome } from './verifier.js'
export type { PluginConfig } from './publisher.js'
