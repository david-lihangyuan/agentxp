/**
 * H7.test.ts
 * Tests for daily-report.ts
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  countPublishedExperiences,
  discoverAgents,
  generateNarrative,
  renderReport,
  type AgentStats,
  type DailyReport,
} from '../scripts/daily-report.js'

const TMP_DIR = resolve(__dirname, '../.tmp-h7-tests')

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

describe('H7: countPublishedExperiences', () => {
  beforeEach(setupTmpDir)
  afterEach(teardownTmpDir)

  it('returns 0 when published dir does not exist', () => {
    const result = countPublishedExperiences(join(TMP_DIR, 'no-agent'))
    expect(result.count).toBe(0)
    expect(result.files).toHaveLength(0)
  })

  it('counts json and md files in published dir', () => {
    const agentDir = join(TMP_DIR, 'test-agent')
    const publishedDir = join(agentDir, 'published')
    mkdirSync(publishedDir, { recursive: true })

    writeFileSync(join(publishedDir, 'exp-1.json'), '{}', 'utf8')
    writeFileSync(join(publishedDir, 'exp-2.json'), '{}', 'utf8')
    writeFileSync(join(publishedDir, 'exp-3.md'), '# exp', 'utf8')
    writeFileSync(join(publishedDir, '.gitkeep'), '', 'utf8') // not counted

    const result = countPublishedExperiences(agentDir)
    expect(result.count).toBe(3)
    expect(result.files).toHaveLength(3)
  })
})

describe('H7: discoverAgents', () => {
  beforeEach(setupTmpDir)
  afterEach(teardownTmpDir)

  it('returns empty array when dir does not exist', () => {
    const agents = discoverAgents(join(TMP_DIR, 'nonexistent'))
    expect(agents).toHaveLength(0)
  })

  it('discovers agents that have SOUL.md', () => {
    const agent1 = join(TMP_DIR, 'agent-alpha')
    const agent2 = join(TMP_DIR, 'agent-beta')
    const notAgent = join(TMP_DIR, 'scripts')

    mkdirSync(agent1, { recursive: true })
    mkdirSync(agent2, { recursive: true })
    mkdirSync(notAgent, { recursive: true })

    writeFileSync(join(agent1, 'SOUL.md'), '# Soul', 'utf8')
    writeFileSync(join(agent2, 'SOUL.md'), '# Soul', 'utf8')
    // notAgent has no SOUL.md

    const agents = discoverAgents(TMP_DIR)
    expect(agents).toContain('agent-alpha')
    expect(agents).toContain('agent-beta')
    expect(agents).not.toContain('scripts')
  })

  it('excludes reserved directory names', () => {
    for (const reserved of ['templates', 'scripts', 'tests', 'reports', 'metrics']) {
      const dir = join(TMP_DIR, reserved)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SOUL.md'), '# Soul', 'utf8')
    }

    const agents = discoverAgents(TMP_DIR)
    expect(agents).toHaveLength(0)
  })
})

describe('H7: generateNarrative', () => {
  it('returns exploration phase message when no experiences', () => {
    const stats: AgentStats[] = [
      {
        agentId: 'coding-01',
        experiencesProduced: 0,
        searchHits: 0,
        verificationsReceived: 0,
        publishedFiles: [],
      },
    ]
    const narrative = generateNarrative(stats)
    expect(narrative).toContain('exploration')
  })

  it('mentions lead agent when experiences produced', () => {
    const stats: AgentStats[] = [
      {
        agentId: 'coding-01',
        experiencesProduced: 5,
        searchHits: 10,
        verificationsReceived: 2,
        publishedFiles: ['exp-1.json'],
      },
      {
        agentId: 'coding-02',
        experiencesProduced: 2,
        searchHits: 3,
        verificationsReceived: 0,
        publishedFiles: [],
      },
    ]
    const narrative = generateNarrative(stats)
    expect(narrative).toContain('coding-01')
    expect(narrative).toContain('7') // total experiences
  })
})

describe('H7: renderReport', () => {
  it('produces markdown with date and summary', () => {
    const report: DailyReport = {
      date: '2026-04-12',
      agents: [
        {
          agentId: 'coding-01',
          experiencesProduced: 3,
          searchHits: 7,
          verificationsReceived: 1,
          publishedFiles: ['exp-1.json'],
        },
      ],
      totals: {
        experiencesProduced: 3,
        searchHits: 7,
        verificationsReceived: 1,
      },
      narrative: 'Test narrative.',
    }

    const md = renderReport(report)
    expect(md).toContain('2026-04-12')
    expect(md).toContain('coding-01')
    expect(md).toContain('Test narrative.')
    expect(md).toContain('|')  // has table
  })

  it('includes cron job comment', () => {
    const report: DailyReport = {
      date: '2026-04-12',
      agents: [],
      totals: { experiencesProduced: 0, searchHits: 0, verificationsReceived: 0 },
      narrative: 'Empty.',
    }
    const md = renderReport(report)
    expect(md).toContain('cron')
  })
})
