#!/usr/bin/env node
/**
 * update-curiosity.ts
 * Reads pulse events from the relay and updates CURIOSITY.md with
 * demand hotspots and white spaces.
 *
 * Usage: npx tsx agents/scripts/update-curiosity.ts \
 *   --pubkey <agent-pubkey> \
 *   --curiosity agents/coding-01/CURIOSITY.md \
 *   --relay https://relay.agentxp.dev
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// Minimum search count to qualify as a demand hotspot
const HOTSPOT_THRESHOLD = 50

export interface PulseEvent {
  query: string
  search_count: number
  result_count: number
  timestamp: string
}

export interface NetworkSignal {
  type: 'hotspot' | 'white-space'
  query: string
  count?: number
  label: string
}

export async function fetchPulseEvents(
  relayUrl: string,
  pubkey: string
): Promise<PulseEvent[]> {
  const url = `${relayUrl}/api/v1/pulse?pubkey=${encodeURIComponent(pubkey)}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Pulse fetch failed: ${response.status} ${response.statusText}`)
  }
  const data = (await response.json()) as { events: PulseEvent[] }
  return data.events || []
}

export function analyzePulseEvents(events: PulseEvent[]): NetworkSignal[] {
  const signals: NetworkSignal[] = []

  for (const event of events) {
    // Demand hotspot: searched many times but no matches found
    if (event.search_count >= HOTSPOT_THRESHOLD && event.result_count === 0) {
      signals.push({
        type: 'hotspot',
        query: event.query,
        count: event.search_count,
        label: `[HOTSPOT] "${event.query}" — searched ${event.search_count} times, unmet demand`,
      })
    }

    // White space: zero results returned for any search
    if (event.result_count === 0) {
      signals.push({
        type: 'white-space',
        query: event.query,
        label: `[WHITE SPACE] "${event.query}" — unexplored territory, no experiences exist`,
      })
    }
  }

  // Deduplicate by query (prefer hotspot over white-space for same query)
  const seen = new Map<string, NetworkSignal>()
  for (const signal of signals) {
    const existing = seen.get(signal.query)
    if (!existing || signal.type === 'hotspot') {
      seen.set(signal.query, signal)
    }
  }

  return Array.from(seen.values())
}

export function updateNetworkSignalsSection(
  content: string,
  signals: NetworkSignal[]
): string {
  if (signals.length === 0) {
    return content
  }

  const signalLines = signals
    .map((s) => `- ${s.label}`)
    .join('\n')

  // Replace the network signals section
  const signalsSectionRegex = /## Network signals\n[\s\S]*?(?=\n---|\n## |$)/
  const newSection = `## Network signals\n\n${signalLines}\n`

  if (signalsSectionRegex.test(content)) {
    return content.replace(signalsSectionRegex, newSection)
  }

  // Append if section not found
  return content + `\n## Network signals\n\n${signalLines}\n`
}

export function markBranchComplete(
  curiosityPath: string,
  archivePath: string,
  branchTopic: string
): void {
  if (!existsSync(curiosityPath)) {
    throw new Error(`CURIOSITY.md not found: ${curiosityPath}`)
  }

  let content = readFileSync(curiosityPath, 'utf8')

  // Find lines containing the branch topic
  const lines = content.split('\n')
  const branchLines: string[] = []
  const remainingLines: string[] = []

  for (const line of lines) {
    if (line.toLowerCase().includes(branchTopic.toLowerCase())) {
      branchLines.push(line)
    } else {
      remainingLines.push(line)
    }
  }

  if (branchLines.length === 0) {
    throw new Error(`Branch topic "${branchTopic}" not found in CURIOSITY.md`)
  }

  // Remove from CURIOSITY.md
  writeFileSync(curiosityPath, remainingLines.join('\n'), 'utf8')

  // Append to archive
  const timestamp = new Date().toISOString()
  const archiveEntry = `\n## Archived: ${branchTopic}\n\n_Completed: ${timestamp}_\n\n${branchLines.join('\n')}\n`

  if (existsSync(archivePath)) {
    const existing = readFileSync(archivePath, 'utf8')
    writeFileSync(archivePath, existing + archiveEntry, 'utf8')
  } else {
    writeFileSync(
      archivePath,
      `# CURIOSITY-ARCHIVE.md\n\nCompleted exploration branches.\n${archiveEntry}`,
      'utf8'
    )
  }

  console.log(`Archived branch "${branchTopic}" to ${archivePath}`)
}

export async function updateCuriosityFromPulse(
  curiosityPath: string,
  relayUrl: string,
  pubkey: string
): Promise<void> {
  if (!existsSync(curiosityPath)) {
    throw new Error(`CURIOSITY.md not found: ${curiosityPath}`)
  }

  const events = await fetchPulseEvents(relayUrl, pubkey)
  const signals = analyzePulseEvents(events)

  if (signals.length === 0) {
    console.log('No new signals from pulse events')
    return
  }

  let content = readFileSync(curiosityPath, 'utf8')
  content = updateNetworkSignalsSection(content, signals)
  writeFileSync(curiosityPath, content, 'utf8')

  console.log(`Updated CURIOSITY.md with ${signals.length} signals`)
  for (const signal of signals) {
    console.log(`  ${signal.label}`)
  }
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith('update-curiosity.ts')) {
  const args = process.argv.slice(2)

  let pubkey = ''
  let curiosityPath = ''
  let relayUrl = 'https://relay.agentxp.dev'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pubkey' && args[i + 1]) {
      pubkey = args[++i]
    } else if (args[i] === '--curiosity' && args[i + 1]) {
      curiosityPath = args[++i]
    } else if (args[i] === '--relay' && args[i + 1]) {
      relayUrl = args[++i]
    }
  }

  if (!pubkey || !curiosityPath) {
    console.error(
      'Usage: update-curiosity.ts --pubkey <key> --curiosity <path> [--relay <url>]'
    )
    process.exit(1)
  }

  updateCuriosityFromPulse(resolve(curiosityPath), relayUrl, pubkey)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error((err as Error).message)
      process.exit(1)
    })
}
