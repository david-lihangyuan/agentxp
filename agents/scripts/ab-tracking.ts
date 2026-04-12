#!/usr/bin/env node
/**
 * ab-tracking.ts
 * A/B experiment tracking for contribution agents.
 *
 * Group A: agents with pulse feedback enabled
 * Group B: agents without pulse feedback (control)
 *
 * Metrics per agent: experiences_produced, hit_rate, verification_rate, exploration_depth
 * Storage: agents/metrics/YYYY-WW.json
 *
 * Usage: npx tsx agents/scripts/ab-tracking.ts --action log --agent coding-01 --group A
 *        npx tsx agents/scripts/ab-tracking.ts --action report
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'

export interface AgentMetrics {
  agentId: string
  group: 'A' | 'B'
  week: string  // YYYY-WW format
  experiencesProduced: number
  hitRate: number         // search hits / experiences published
  verificationRate: number // verifications / experiences published
  explorationDepth: number // deepest layer reached in question tree
  updatedAt: string
}

export interface WeeklyMetricsFile {
  week: string
  agents: Record<string, AgentMetrics>
}

export interface ExperimentReport {
  week: string
  groups: GroupSummary[]
  comparison: ComparisonResult
}

export interface GroupSummary {
  group: 'A' | 'B'
  label: string
  agentCount: number
  avgExperiencesProduced: number
  avgHitRate: number
  avgVerificationRate: number
  avgExplorationDepth: number
}

export interface ComparisonResult {
  winner: 'A' | 'B' | 'tie'
  hitRateDelta: number
  verificationRateDelta: number
  explorationDepthDelta: number
  narrative: string
}

export function getWeekString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const startOfYear = new Date(year, 0, 1)
  const weekNumber = Math.ceil(
    ((date.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7
  )
  return `${year}-${String(weekNumber).padStart(2, '0')}`
}

export function getMetricsPath(metricsDir: string, week: string): string {
  return join(metricsDir, `${week}.json`)
}

export function loadWeeklyMetrics(metricsPath: string): WeeklyMetricsFile {
  if (!existsSync(metricsPath)) {
    return {
      week: '',
      agents: {},
    }
  }
  try {
    return JSON.parse(readFileSync(metricsPath, 'utf8')) as WeeklyMetricsFile
  } catch {
    return { week: '', agents: {} }
  }
}

export function saveWeeklyMetrics(
  metricsPath: string,
  data: WeeklyMetricsFile
): void {
  const dir = metricsPath.substring(0, metricsPath.lastIndexOf('/'))
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(metricsPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export async function getAgentMetrics(
  agentId: string,
  metricsDir: string,
  week: string = getWeekString()
): Promise<AgentMetrics | null> {
  const metricsPath = getMetricsPath(metricsDir, week)
  const data = loadWeeklyMetrics(metricsPath)
  return data.agents[agentId] || null
}

export function logAgentMetrics(
  metrics: AgentMetrics,
  metricsDir: string
): void {
  const week = metrics.week || getWeekString()
  const metricsPath = getMetricsPath(metricsDir, week)
  const data = loadWeeklyMetrics(metricsPath)

  data.week = week
  data.agents[metrics.agentId] = {
    ...metrics,
    week,
    updatedAt: new Date().toISOString(),
  }

  saveWeeklyMetrics(metricsPath, data)
  console.log(`Logged metrics for agent ${metrics.agentId} (week ${week})`)
}

export function summarizeGroup(
  agents: AgentMetrics[],
  group: 'A' | 'B'
): GroupSummary {
  const groupAgents = agents.filter((a) => a.group === group)

  if (groupAgents.length === 0) {
    return {
      group,
      label: group === 'A' ? 'With pulse feedback' : 'Without pulse feedback (control)',
      agentCount: 0,
      avgExperiencesProduced: 0,
      avgHitRate: 0,
      avgVerificationRate: 0,
      avgExplorationDepth: 0,
    }
  }

  const avg = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / values.length

  return {
    group,
    label: group === 'A' ? 'With pulse feedback' : 'Without pulse feedback (control)',
    agentCount: groupAgents.length,
    avgExperiencesProduced: avg(groupAgents.map((a) => a.experiencesProduced)),
    avgHitRate: avg(groupAgents.map((a) => a.hitRate)),
    avgVerificationRate: avg(groupAgents.map((a) => a.verificationRate)),
    avgExplorationDepth: avg(groupAgents.map((a) => a.explorationDepth)),
  }
}

export function compareGroups(
  groupA: GroupSummary,
  groupB: GroupSummary
): ComparisonResult {
  const hitRateDelta = groupA.avgHitRate - groupB.avgHitRate
  const verificationRateDelta =
    groupA.avgVerificationRate - groupB.avgVerificationRate
  const explorationDepthDelta =
    groupA.avgExplorationDepth - groupB.avgExplorationDepth

  // Simple scoring: A wins if it outperforms on 2+ of 3 metrics
  const aWins = [
    hitRateDelta > 0,
    verificationRateDelta > 0,
    explorationDepthDelta > 0,
  ].filter(Boolean).length

  const winner: 'A' | 'B' | 'tie' =
    aWins >= 2 ? 'A' : aWins <= 1 ? 'B' : 'tie'

  let narrative = ''
  if (groupA.agentCount === 0 || groupB.agentCount === 0) {
    narrative = 'Insufficient data for comparison — one or both groups have no agents.'
  } else if (winner === 'A') {
    narrative = `Group A (with pulse feedback) outperformed Group B on ${aWins}/3 metrics. ` +
      `Hit rate delta: ${(hitRateDelta * 100).toFixed(1)}pp. ` +
      `Pulse feedback appears beneficial.`
  } else if (winner === 'B') {
    narrative = `Group B (control) outperformed Group A on ${3 - aWins}/3 metrics. ` +
      `Pulse feedback may be adding noise rather than signal.`
  } else {
    narrative = `Groups A and B performed similarly. ` +
      `No clear advantage from pulse feedback at this sample size.`
  }

  return {
    winner,
    hitRateDelta,
    verificationRateDelta,
    explorationDepthDelta,
    narrative,
  }
}

export async function generateExperimentReport(
  metricsDir: string,
  week: string = getWeekString()
): Promise<ExperimentReport> {
  const metricsPath = getMetricsPath(metricsDir, week)
  const data = loadWeeklyMetrics(metricsPath)
  const allAgents = Object.values(data.agents)

  const groupA = summarizeGroup(allAgents, 'A')
  const groupB = summarizeGroup(allAgents, 'B')
  const comparison = compareGroups(groupA, groupB)

  return {
    week,
    groups: [groupA, groupB],
    comparison,
  }
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith('ab-tracking.ts')) {
  const args = process.argv.slice(2)

  let action = 'report'
  let agentId = ''
  let group: 'A' | 'B' = 'A'
  let week = getWeekString()
  let experiencesProduced = 0
  let hitRate = 0
  let verificationRate = 0
  let explorationDepth = 0

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--action' && args[i + 1]) action = args[++i]
    else if (args[i] === '--agent' && args[i + 1]) agentId = args[++i]
    else if (args[i] === '--group' && args[i + 1]) group = args[++i] as 'A' | 'B'
    else if (args[i] === '--week' && args[i + 1]) week = args[++i]
    else if (args[i] === '--experiences' && args[i + 1])
      experiencesProduced = parseInt(args[++i])
    else if (args[i] === '--hit-rate' && args[i + 1])
      hitRate = parseFloat(args[++i])
    else if (args[i] === '--verification-rate' && args[i + 1])
      verificationRate = parseFloat(args[++i])
    else if (args[i] === '--exploration-depth' && args[i + 1])
      explorationDepth = parseInt(args[++i])
  }

  const metricsDir = resolve(process.cwd(), 'metrics')

  if (action === 'log') {
    if (!agentId) {
      console.error('--agent required for log action')
      process.exit(1)
    }

    logAgentMetrics(
      {
        agentId,
        group,
        week,
        experiencesProduced,
        hitRate,
        verificationRate,
        explorationDepth,
        updatedAt: new Date().toISOString(),
      },
      metricsDir
    )
  } else if (action === 'report') {
    generateExperimentReport(metricsDir, week)
      .then((report) => {
        console.log(JSON.stringify(report, null, 2))
        process.exit(0)
      })
      .catch((err) => {
        console.error((err as Error).message)
        process.exit(1)
      })
  }
}
