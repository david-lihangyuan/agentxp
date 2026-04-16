// trace-analytics.ts — L2 Trace Aggregation Analytics
// Computes per-domain insights and global behavioral patterns from reasoning traces.

import type { ReasoningTrace } from '@serendip/protocol'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DomainInsight {
  domain_ecosystem: string
  domain_layer: string
  total_traces: number
  avg_steps: number
  avg_dead_ends: number
  most_common_dead_end_actions: Array<{ action: string; count: number }>
  success_rate: number
  most_common_actions: Array<{ action: string; count: number }>
  weakness_indicators: string[]
}

export interface GlobalPattern {
  pattern: string
  description: string
  frequency: number   // ratio of experiences where this pattern applies (0.0–1.0)
  confidence: number  // ratio of apply-group that succeeded (0.0–1.0)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

function topN<T extends { count: number }>(items: T[], n = 5): T[] {
  return [...items].sort((a, b) => b.count - a.count).slice(0, n)
}

function countMap(values: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const v of values) {
    m.set(v, (m.get(v) ?? 0) + 1)
  }
  return m
}

function mapToRanked(m: Map<string, number>): Array<{ action: string; count: number }> {
  return Array.from(m.entries()).map(([action, count]) => ({ action, count }))
}

// ---------------------------------------------------------------------------
// computeDomainInsights
// ---------------------------------------------------------------------------

/**
 * Compute per-domain aggregated insights from a flat list of experiences.
 * Experiences without a valid reasoning_trace still contribute to success_rate
 * and total_traces; their step/dead-end counts are treated as 0.
 */
export function computeDomainInsights(
  experiences: Array<{
    reasoning_trace: string | null
    outcome: string
    domain_ecosystem: string
    domain_layer: string
  }>
): DomainInsight[] {
  // Group by domain key
  const groups = new Map<
    string,
    Array<{
      reasoning_trace: string | null
      outcome: string
      domain_ecosystem: string
      domain_layer: string
    }>
  >()

  for (const exp of experiences) {
    const key = `${exp.domain_ecosystem}::${exp.domain_layer}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(exp)
  }

  const insights: DomainInsight[] = []

  for (const [, group] of groups) {
    const ecosystem = group[0].domain_ecosystem
    const layer = group[0].domain_layer
    const total = group.length

    let totalSteps = 0
    let totalDeadEnds = 0
    let successCount = 0

    const actionCounts = new Map<string, number>()
    const deadEndActionCounts = new Map<string, number>()

    for (const exp of group) {
      if (isSuccess(exp.outcome)) successCount++

      const trace = parseTrace(exp.reasoning_trace)
      if (!trace) continue

      totalSteps += trace.steps.length
      totalDeadEnds += trace.dead_ends.length

      // Count step actions
      for (const step of trace.steps) {
        actionCounts.set(step.action, (actionCounts.get(step.action) ?? 0) + 1)
      }

      // Count dead-end "tried" field as action label
      for (const de of trace.dead_ends) {
        const key = de.tried
        deadEndActionCounts.set(key, (deadEndActionCounts.get(key) ?? 0) + 1)
      }
    }

    const avgSteps = total > 0 ? totalSteps / total : 0
    const avgDeadEnds = total > 0 ? totalDeadEnds / total : 0
    const successRate = total > 0 ? successCount / total : 0

    // Derive weakness indicators
    const weaknessIndicators: string[] = []
    if (avgDeadEnds > 1.5) weaknessIndicators.push('high_dead_end_rate')
    if (avgSteps > 8) weaknessIndicators.push('high_step_count')
    if (successRate < 0.5) weaknessIndicators.push('low_success_rate')
    if (avgDeadEnds > 0 && successRate < 0.3) weaknessIndicators.push('struggling_domain')

    insights.push({
      domain_ecosystem: ecosystem,
      domain_layer: layer,
      total_traces: total,
      avg_steps: avgSteps,
      avg_dead_ends: avgDeadEnds,
      most_common_dead_end_actions: topN(mapToRanked(deadEndActionCounts)),
      success_rate: successRate,
      most_common_actions: topN(mapToRanked(actionCounts)),
      weakness_indicators: weaknessIndicators,
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// discoverPatterns
// ---------------------------------------------------------------------------

/**
 * Discover global behavioral patterns from experiences.
 *
 * Patterns detected:
 * - "investigate_before_decide": investigate appears before decide in the trace steps
 * - "backtrack_leads_to_success": experiences containing backtrack action
 * - "dead_end_recovery": experiences with dead_ends that still succeeded
 * - "quick_conclude": experiences with < 3 total steps
 */
export function discoverPatterns(
  experiences: Array<{
    reasoning_trace: string | null
    outcome: string
  }>
): GlobalPattern[] {
  if (experiences.length === 0) return []

  const total = experiences.length

  // ── investigate_before_decide ──────────────────────────────────────────
  let ibdApply = 0  // has investigate before decide
  let ibdSuccess = 0

  // ── backtrack_leads_to_success ─────────────────────────────────────────
  let btApply = 0   // has backtrack
  let btSuccess = 0

  // ── dead_end_recovery ─────────────────────────────────────────────────
  let derApply = 0  // has dead ends
  let derSuccess = 0

  // ── quick_conclude ─────────────────────────────────────────────────────
  let qcApply = 0   // steps < 3
  let qcSuccess = 0

  for (const exp of experiences) {
    const trace = parseTrace(exp.reasoning_trace)
    const succeeded = isSuccess(exp.outcome)

    if (trace) {
      const actions = trace.steps.map((s) => s.action)
      const investIdx = actions.indexOf('investigate')
      const decideIdx = actions.indexOf('decide')

      // investigate_before_decide
      if (investIdx !== -1 && decideIdx !== -1 && investIdx < decideIdx) {
        ibdApply++
        if (succeeded) ibdSuccess++
      }

      // backtrack_leads_to_success
      if (actions.includes('backtrack')) {
        btApply++
        if (succeeded) btSuccess++
      }

      // dead_end_recovery
      if (trace.dead_ends.length > 0) {
        derApply++
        if (succeeded) derSuccess++
      }

      // quick_conclude
      if (trace.steps.length < 3) {
        qcApply++
        if (succeeded) qcSuccess++
      }
    }
    // Experiences without a trace contribute to total but not to any pattern group
  }

  const patterns: GlobalPattern[] = [
    {
      pattern: 'investigate_before_decide',
      description: 'Traces where investigate step precedes decide step correlate with higher success',
      frequency: ibdApply / total,
      confidence: ibdApply > 0 ? ibdSuccess / ibdApply : 0,
    },
    {
      pattern: 'backtrack_leads_to_success',
      description: 'Traces containing a backtrack action and their success rate',
      frequency: btApply / total,
      confidence: btApply > 0 ? btSuccess / btApply : 0,
    },
    {
      pattern: 'dead_end_recovery',
      description: 'Ratio of experiences with dead-ends that still succeeded (recovery ability)',
      frequency: derApply / total,
      confidence: derApply > 0 ? derSuccess / derApply : 0,
    },
    {
      pattern: 'quick_conclude',
      description: 'Experiences resolved in fewer than 3 steps and their success rate',
      frequency: qcApply / total,
      confidence: qcApply > 0 ? qcSuccess / qcApply : 0,
    },
  ]

  return patterns
}
