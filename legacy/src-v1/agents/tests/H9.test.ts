/**
 * H9.test.ts
 * Tests for ab-tracking.ts — A/B experiment tracking
 */

import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getWeekString,
  logAgentMetrics,
  getAgentMetrics,
  generateExperimentReport,
  summarizeGroup,
  compareGroups,
  type AgentMetrics,
} from '../scripts/ab-tracking.js'

const TMP_DIR = resolve(__dirname, '../.tmp-h9-tests')

function setupTmpDir() {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true })
  }
  mkdirSync(TMP_DIR, { recursive: true })
}

function teardownTmpDir() {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true })
  }
}

describe('H9: getWeekString', () => {
  it('returns YYYY-WW format', () => {
    const week = getWeekString()
    expect(week).toMatch(/^\d{4}-\d{2}$/)
  })

  it('returns same week for same date', () => {
    const date = new Date('2026-04-12')
    const week1 = getWeekString(date)
    const week2 = getWeekString(date)
    expect(week1).toBe(week2)
  })
})

describe('H9: logAgentMetrics and getAgentMetrics', () => {
  beforeEach(setupTmpDir)
  afterEach(teardownTmpDir)

  it('stores metrics correctly', async () => {
    const week = '2026-15'
    const metrics: AgentMetrics = {
      agentId: 'coding-01',
      group: 'A',
      week,
      experiencesProduced: 5,
      hitRate: 0.6,
      verificationRate: 0.4,
      explorationDepth: 3,
      updatedAt: new Date().toISOString(),
    }

    logAgentMetrics(metrics, TMP_DIR)

    const retrieved = await getAgentMetrics('coding-01', TMP_DIR, week)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.experiencesProduced).toBe(5)
    expect(retrieved!.hitRate).toBe(0.6)
    expect(retrieved!.verificationRate).toBe(0.4)
    expect(retrieved!.explorationDepth).toBe(3)
  })

  it('metrics have required fields', async () => {
    const week = '2026-15'
    const metrics: AgentMetrics = {
      agentId: 'coding-01',
      group: 'A',
      week,
      experiencesProduced: 3,
      hitRate: 0.5,
      verificationRate: 0.3,
      explorationDepth: 2,
      updatedAt: new Date().toISOString(),
    }

    logAgentMetrics(metrics, TMP_DIR)
    const retrieved = await getAgentMetrics('coding-01', TMP_DIR, week)

    expect(retrieved!.experiencesProduced).toBeDefined()
    expect(retrieved!.hitRate).toBeDefined()
    expect(retrieved!.verificationRate).toBeDefined()
    expect(retrieved!.explorationDepth).toBeDefined()
  })

  it('returns null for unknown agent', async () => {
    const result = await getAgentMetrics('nonexistent-agent', TMP_DIR, '2026-15')
    expect(result).toBeNull()
  })

  it('saves metrics file in YYYY-WW.json format', () => {
    const week = '2026-15'
    const metrics: AgentMetrics = {
      agentId: 'coding-01',
      group: 'A',
      week,
      experiencesProduced: 1,
      hitRate: 0.1,
      verificationRate: 0.1,
      explorationDepth: 1,
      updatedAt: new Date().toISOString(),
    }

    logAgentMetrics(metrics, TMP_DIR)

    const expectedPath = join(TMP_DIR, `${week}.json`)
    expect(existsSync(expectedPath)).toBe(true)

    const content = JSON.parse(readFileSync(expectedPath, 'utf8'))
    expect(content.week).toBe(week)
    expect(content.agents['coding-01']).toBeDefined()
  })

  it('supports multiple agents in same week file', async () => {
    const week = '2026-15'

    logAgentMetrics({
      agentId: 'coding-01',
      group: 'A',
      week,
      experiencesProduced: 5,
      hitRate: 0.6,
      verificationRate: 0.4,
      explorationDepth: 3,
      updatedAt: new Date().toISOString(),
    }, TMP_DIR)

    logAgentMetrics({
      agentId: 'coding-02',
      group: 'B',
      week,
      experiencesProduced: 2,
      hitRate: 0.2,
      verificationRate: 0.1,
      explorationDepth: 1,
      updatedAt: new Date().toISOString(),
    }, TMP_DIR)

    const a1 = await getAgentMetrics('coding-01', TMP_DIR, week)
    const a2 = await getAgentMetrics('coding-02', TMP_DIR, week)

    expect(a1!.group).toBe('A')
    expect(a2!.group).toBe('B')
  })
})

describe('H9: generateExperimentReport', () => {
  beforeEach(setupTmpDir)
  afterEach(teardownTmpDir)

  it('report has groups array', async () => {
    const week = '2026-15'
    const report = await generateExperimentReport(TMP_DIR, week)
    expect(report.groups).toBeDefined()
    expect(Array.isArray(report.groups)).toBe(true)
  })

  it('report has at least 2 groups', async () => {
    const week = '2026-15'
    const report = await generateExperimentReport(TMP_DIR, week)
    expect(report.groups.length).toBeGreaterThanOrEqual(2)
  })

  it('report has comparison', async () => {
    const week = '2026-15'
    const report = await generateExperimentReport(TMP_DIR, week)
    expect(report.comparison).toBeDefined()
  })

  it('comparison narrative is present with data', async () => {
    const week = '2026-15'

    // Add some agents
    logAgentMetrics({
      agentId: 'agent-a1',
      group: 'A',
      week,
      experiencesProduced: 8,
      hitRate: 0.7,
      verificationRate: 0.5,
      explorationDepth: 4,
      updatedAt: new Date().toISOString(),
    }, TMP_DIR)

    logAgentMetrics({
      agentId: 'agent-b1',
      group: 'B',
      week,
      experiencesProduced: 3,
      hitRate: 0.3,
      verificationRate: 0.2,
      explorationDepth: 2,
      updatedAt: new Date().toISOString(),
    }, TMP_DIR)

    const report = await generateExperimentReport(TMP_DIR, week)
    expect(report.comparison.narrative).toBeDefined()
    expect(report.comparison.narrative.length).toBeGreaterThan(0)
    expect(report.comparison.winner).toMatch(/^(A|B|tie)$/)
  })
})

describe('H9: summarizeGroup', () => {
  it('returns zero stats for empty group', () => {
    const summary = summarizeGroup([], 'A')
    expect(summary.agentCount).toBe(0)
    expect(summary.avgHitRate).toBe(0)
  })

  it('correctly averages metrics', () => {
    const agents: AgentMetrics[] = [
      {
        agentId: 'a1',
        group: 'A',
        week: '2026-15',
        experiencesProduced: 10,
        hitRate: 0.8,
        verificationRate: 0.6,
        explorationDepth: 4,
        updatedAt: '',
      },
      {
        agentId: 'a2',
        group: 'A',
        week: '2026-15',
        experiencesProduced: 6,
        hitRate: 0.4,
        verificationRate: 0.2,
        explorationDepth: 2,
        updatedAt: '',
      },
    ]
    const summary = summarizeGroup(agents, 'A')
    expect(summary.avgHitRate).toBeCloseTo(0.6)
    expect(summary.avgExplorationDepth).toBeCloseTo(3)
    expect(summary.agentCount).toBe(2)
  })
})
