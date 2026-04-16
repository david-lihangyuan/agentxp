// agent-growth.ts — Agent Capability Growth Tracking (#26)
// Computes per-agent, per-domain growth profiles over a time window.

import type Database from 'better-sqlite3'
import type { ReasoningTrace } from '@serendip/protocol'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentGrowthProfile {
  pubkey: string
  domain_ecosystem: string
  domain_layer: string
  period_start: number        // unix timestamp (seconds)
  period_end: number          // unix timestamp (seconds)
  avg_steps: number
  avg_dead_ends: number
  success_rate: number        // 0.0 – 1.0
  avg_duration_seconds: number
  experience_count: number
  trend: 'improving' | 'stable' | 'degrading'
}

export interface ExperienceInput {
  reasoning_trace: string | null  // JSON-encoded ReasoningTrace
  outcome: string                  // 'succeeded' | 'failed' | 'partial' | 'inconclusive'
  created_at: number               // unix timestamp
  domain_ecosystem: string
  domain_layer: string
}

// ---------------------------------------------------------------------------
// Duration-bucket → seconds mapping (midpoints)
// ---------------------------------------------------------------------------

const DURATION_BUCKET_SECONDS: Record<string, number> = {
  under_1min: 30,
  '1_to_5min': 180,
  '5_to_15min': 600,
  over_15min: 1200,
}

function parseTrace(raw: string | null): ReasoningTrace | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ReasoningTrace
  } catch {
    return null
  }
}

function isSuccess(outcome: string): boolean {
  return outcome === 'succeeded'
}

function durationSeconds(trace: ReasoningTrace): number {
  return DURATION_BUCKET_SECONDS[trace.duration_bucket] ?? 0
}

// ---------------------------------------------------------------------------
// Trend detection
// ---------------------------------------------------------------------------

interface HalfStats {
  avg_steps: number
  avg_dead_ends: number
  success_rate: number
}

function halfStats(experiences: ExperienceInput[]): HalfStats {
  if (experiences.length === 0) {
    return { avg_steps: 0, avg_dead_ends: 0, success_rate: 0 }
  }
  let totalSteps = 0
  let totalDeadEnds = 0
  let successCount = 0

  for (const exp of experiences) {
    const trace = parseTrace(exp.reasoning_trace)
    totalSteps += trace ? trace.steps.length : 0
    totalDeadEnds += trace ? trace.dead_ends.length : 0
    if (isSuccess(exp.outcome)) successCount++
  }

  return {
    avg_steps: totalSteps / experiences.length,
    avg_dead_ends: totalDeadEnds / experiences.length,
    success_rate: successCount / experiences.length,
  }
}

function determineTrend(sorted: ExperienceInput[]): 'improving' | 'stable' | 'degrading' {
  if (sorted.length < 2) return 'stable'

  const mid = Math.floor(sorted.length / 2)
  const first = sorted.slice(0, mid)
  const second = sorted.slice(mid)

  const s1 = halfStats(first)
  const s2 = halfStats(second)

  // Improving: steps reduced ≥20% AND success rate not declining
  if (s1.avg_steps > 0) {
    const stepsDelta = (s1.avg_steps - s2.avg_steps) / s1.avg_steps
    if (stepsDelta >= 0.2 && s2.success_rate >= s1.success_rate) {
      return 'improving'
    }
  }

  // Degrading: steps increased ≥20% OR success rate dropped ≥20%
  if (s1.avg_steps > 0) {
    const stepsIncrease = (s2.avg_steps - s1.avg_steps) / s1.avg_steps
    if (stepsIncrease >= 0.2) return 'degrading'
  }

  if (s1.success_rate > 0) {
    const successDrop = (s1.success_rate - s2.success_rate) / s1.success_rate
    if (successDrop >= 0.2) return 'degrading'
  }

  return 'stable'
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute a growth profile for one agent in one domain over periodDays.
 *
 * @param experiences  All candidate experiences (pre-filtered to agent + time window by caller if needed)
 * @param pubkey       Agent identifier (stored in profile for reference)
 * @param domain       Domain to filter and profile
 * @param periodDays   Look-back window in days (default 30). period_end = now.
 * @returns            Profile or null if no matching experiences in the window
 */
export function computeGrowthProfile(
  experiences: ExperienceInput[],
  pubkey: string,
  domain: { ecosystem: string; layer: string },
  periodDays: number = 30
): AgentGrowthProfile | null {
  const now = Math.floor(Date.now() / 1000)
  const periodStart = now - periodDays * 86400

  // Filter by domain and time window
  const filtered = experiences.filter(
    (e) =>
      e.domain_ecosystem === domain.ecosystem &&
      e.domain_layer === domain.layer &&
      e.created_at >= periodStart &&
      e.created_at <= now
  )

  if (filtered.length === 0) return null

  // Sort chronologically for trend analysis
  const sorted = [...filtered].sort((a, b) => a.created_at - b.created_at)

  let totalSteps = 0
  let totalDeadEnds = 0
  let totalDuration = 0
  let successCount = 0

  for (const exp of sorted) {
    const trace = parseTrace(exp.reasoning_trace)
    totalSteps += trace ? trace.steps.length : 0
    totalDeadEnds += trace ? trace.dead_ends.length : 0
    totalDuration += trace ? durationSeconds(trace) : 0
    if (isSuccess(exp.outcome)) successCount++
  }

  const count = sorted.length

  return {
    pubkey,
    domain_ecosystem: domain.ecosystem,
    domain_layer: domain.layer,
    period_start: periodStart,
    period_end: now,
    avg_steps: totalSteps / count,
    avg_dead_ends: totalDeadEnds / count,
    success_rate: successCount / count,
    avg_duration_seconds: totalDuration / count,
    experience_count: count,
    trend: determineTrend(sorted),
  }
}

// ---------------------------------------------------------------------------
// DB query
// ---------------------------------------------------------------------------

interface DbExperienceRow {
  reasoning_trace: string | null
  outcome: string
  created_at: number
  domain_ecosystem: string | null
  domain_layer: string | null
}

/**
 * Query the database and compute growth profiles for all domain combinations
 * the agent has experiences in.
 */
export function getGrowthProfiles(
  db: Database.Database,
  pubkey: string,
  periodDays: number = 30
): AgentGrowthProfile[] {
  const now = Math.floor(Date.now() / 1000)
  const periodStart = now - periodDays * 86400

  const rows = db
    .prepare(
      `
      SELECT reasoning_trace, outcome, created_at, domain_ecosystem, domain_layer
      FROM experiences
      WHERE pubkey = ?
        AND created_at >= ?
        AND deprecated_at IS NULL
    `
    )
    .all(pubkey, periodStart) as DbExperienceRow[]

  // Group by domain_ecosystem + domain_layer
  const domainMap = new Map<string, ExperienceInput[]>()

  for (const row of rows) {
    const ecosystem = row.domain_ecosystem ?? ''
    const layer = row.domain_layer ?? ''
    const key = `${ecosystem}::${layer}`
    if (!domainMap.has(key)) domainMap.set(key, [])
    domainMap.get(key)!.push({
      reasoning_trace: row.reasoning_trace,
      outcome: row.outcome,
      created_at: row.created_at,
      domain_ecosystem: ecosystem,
      domain_layer: layer,
    })
  }

  const profiles: AgentGrowthProfile[] = []

  for (const [, exps] of domainMap) {
    const domain = { ecosystem: exps[0].domain_ecosystem, layer: exps[0].domain_layer }
    const profile = computeGrowthProfile(exps, pubkey, domain, periodDays)
    if (profile) profiles.push(profile)
  }

  return profiles
}
