#!/usr/bin/env node
/**
 * daily-report.ts
 * Generates a daily experiment report for all contribution agents.
 *
 * Stats: experiences produced, search hits, verifications received
 * Output: agents/reports/YYYY-MM-DD.md
 *
 * Usage: npx tsx agents/scripts/daily-report.ts [--relay <url>] [--date YYYY-MM-DD]
 */

import { writeFileSync, readdirSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'

export interface AgentStats {
  agentId: string
  experiencesProduced: number
  searchHits: number
  verificationsReceived: number
  publishedFiles: string[]
}

export interface DailyReport {
  date: string
  agents: AgentStats[]
  totals: {
    experiencesProduced: number
    searchHits: number
    verificationsReceived: number
  }
  narrative: string
}

export function countPublishedExperiences(agentDir: string): {
  count: number
  files: string[]
} {
  const publishedDir = join(agentDir, 'published')
  if (!existsSync(publishedDir)) {
    return { count: 0, files: [] }
  }

  try {
    const files = readdirSync(publishedDir).filter(
      (f) => f.endsWith('.json') || f.endsWith('.md')
    )
    return { count: files.length, files }
  } catch {
    return { count: 0, files: [] }
  }
}

export async function fetchAgentPulseStats(
  relayUrl: string,
  agentId: string
): Promise<{ searchHits: number; verificationsReceived: number }> {
  try {
    const url = `${relayUrl}/api/v1/pulse?agent=${encodeURIComponent(agentId)}&stats=true`
    const response = await fetch(url)
    if (!response.ok) {
      return { searchHits: 0, verificationsReceived: 0 }
    }
    const data = (await response.json()) as {
      search_hits?: number
      verifications?: number
    }
    return {
      searchHits: data.search_hits || 0,
      verificationsReceived: data.verifications || 0,
    }
  } catch {
    return { searchHits: 0, verificationsReceived: 0 }
  }
}

export function discoverAgents(agentsRootDir: string): string[] {
  if (!existsSync(agentsRootDir)) {
    return []
  }

  try {
    return readdirSync(agentsRootDir, { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() &&
          !['templates', 'scripts', 'tests', 'reports', 'metrics'].includes(d.name) &&
          existsSync(join(agentsRootDir, d.name, 'SOUL.md'))
      )
      .map((d) => d.name)
  } catch {
    return []
  }
}

export function generateNarrative(stats: AgentStats[]): string {
  const total = stats.reduce((acc, s) => acc + s.experiencesProduced, 0)
  const totalHits = stats.reduce((acc, s) => acc + s.searchHits, 0)
  const totalVerifs = stats.reduce((acc, s) => acc + s.verificationsReceived, 0)

  if (total === 0) {
    return `No experiences were published today. Agents are in exploration phase.`
  }

  const topAgent = stats.reduce((best, s) =>
    s.experiencesProduced > best.experiencesProduced ? s : best
  )

  const parts: string[] = []
  parts.push(
    `${total} experience${total !== 1 ? 's' : ''} produced across ${stats.filter((s) => s.experiencesProduced > 0).length} active agent${stats.filter((s) => s.experiencesProduced > 0).length !== 1 ? 's' : ''}.`
  )

  if (topAgent.experiencesProduced > 0) {
    parts.push(`${topAgent.agentId} led with ${topAgent.experiencesProduced} experiences.`)
  }

  if (totalHits > 0) {
    parts.push(`${totalHits} search hit${totalHits !== 1 ? 's' : ''} received from the network.`)
  }

  if (totalVerifs > 0) {
    parts.push(
      `${totalVerifs} verification${totalVerifs !== 1 ? 's' : ''} received — experiences confirmed useful.`
    )
  }

  return parts.join(' ')
}

export function renderReport(report: DailyReport): string {
  const agentRows = report.agents
    .map(
      (a) =>
        `| ${a.agentId} | ${a.experiencesProduced} | ${a.searchHits} | ${a.verificationsReceived} |`
    )
    .join('\n')

  return `# Daily Experiment Report — ${report.date}

## Summary

${report.narrative}

## Agent Stats

| Agent | Experiences Produced | Search Hits | Verifications |
|-------|---------------------|-------------|---------------|
${agentRows}
| **TOTAL** | **${report.totals.experiencesProduced}** | **${report.totals.searchHits}** | **${report.totals.verificationsReceived}** |

## Details

${report.agents
  .map(
    (a) => `### ${a.agentId}

- Experiences: ${a.experiencesProduced}
- Published files: ${a.publishedFiles.length > 0 ? a.publishedFiles.join(', ') : 'none'}
- Search hits: ${a.searchHits}
- Verifications: ${a.verificationsReceived}
`
  )
  .join('\n')}

---

_Generated: ${new Date().toISOString()}_
_Can be run as a cron job: \`0 23 * * * npx tsx agents/scripts/daily-report.ts\`_
`
}

export async function generateDailyReport(options: {
  agentsRootDir: string
  reportsDir: string
  relayUrl?: string
  date?: string
}): Promise<DailyReport> {
  const {
    agentsRootDir,
    reportsDir,
    relayUrl = 'https://relay.agentxp.dev',
    date = new Date().toISOString().split('T')[0],
  } = options

  const agentIds = discoverAgents(agentsRootDir)

  const agentStats: AgentStats[] = await Promise.all(
    agentIds.map(async (agentId) => {
      const agentDir = join(agentsRootDir, agentId)
      const { count, files } = countPublishedExperiences(agentDir)
      const pulseStats = await fetchAgentPulseStats(relayUrl, agentId)

      return {
        agentId,
        experiencesProduced: count,
        searchHits: pulseStats.searchHits,
        verificationsReceived: pulseStats.verificationsReceived,
        publishedFiles: files,
      }
    })
  )

  const totals = agentStats.reduce(
    (acc, s) => ({
      experiencesProduced: acc.experiencesProduced + s.experiencesProduced,
      searchHits: acc.searchHits + s.searchHits,
      verificationsReceived: acc.verificationsReceived + s.verificationsReceived,
    }),
    { experiencesProduced: 0, searchHits: 0, verificationsReceived: 0 }
  )

  const report: DailyReport = {
    date,
    agents: agentStats,
    totals,
    narrative: generateNarrative(agentStats),
  }

  // Save report
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true })
  }

  const reportPath = join(reportsDir, `${date}.md`)
  writeFileSync(reportPath, renderReport(report), 'utf8')
  console.log(`Report saved: ${reportPath}`)

  return report
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith('daily-report.ts')) {
  const args = process.argv.slice(2)

  let relayUrl = 'https://relay.agentxp.dev'
  let date = new Date().toISOString().split('T')[0]

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--relay' && args[i + 1]) {
      relayUrl = args[++i]
    } else if (args[i] === '--date' && args[i + 1]) {
      date = args[++i]
    }
  }

  const agentsRootDir = resolve(process.cwd())
  const reportsDir = resolve(process.cwd(), 'reports')

  generateDailyReport({ agentsRootDir, reportsDir, relayUrl, date })
    .then((report) => {
      console.log(`Narrative: ${report.narrative}`)
      process.exit(0)
    })
    .catch((err) => {
      console.error((err as Error).message)
      process.exit(1)
    })
}
