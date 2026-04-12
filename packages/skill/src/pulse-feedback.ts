// H5: Pulse Feedback — surface relay white spaces into CURIOSITY.md
// Queries relay search for known topic areas; identifies gaps (0 results);
// injects "white space" hints into the agent's CURIOSITY.md so the next
// heartbeat naturally explores uncovered territory.

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface WhiteSpace {
  query: string
  resultCount: number
}

export interface PulseFeedbackResult {
  whiteSpaces: WhiteSpace[]
  injected: boolean
  curiosityPath: string | null
  message: string
}

// Canonical probe queries — broad enough to surface gaps across domains
const PROBE_QUERIES = [
  // Coding domain
  'agent retry error recovery',
  'output validation schema enforcement',
  'state rollback multi-step agent',
  'token budget overflow agent loop',
  'tool call timeout fallback',
  // Thinking domain
  'reframe stuck decision',
  'level jumping insight pattern',
  'substitution test thinking move',
  'forcing function behavior change',
  'obvious next step trap',
]

/**
 * Query the relay search endpoint for a single term.
 * Returns the number of results (0 = white space).
 */
async function probeRelay(relayUrl: string, query: string): Promise<number> {
  const url = `${relayUrl}/api/v1/search?q=${encodeURIComponent(query)}&limit=1`
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return -1
    const data = await resp.json() as { results?: unknown[] }
    return Array.isArray(data.results) ? data.results.length : 0
  } catch {
    return -1
  }
}

/**
 * Find the CURIOSITY.md file in the agent workspace.
 */
function findCuriosityFile(workspaceDir: string): string | null {
  const candidate = join(workspaceDir, 'CURIOSITY.md')
  if (existsSync(candidate)) return candidate
  return null
}

/**
 * Inject white-space hints into CURIOSITY.md.
 * Appends a "## Network White Spaces (auto-updated)" section,
 * replacing any previous version of that section.
 */
function injectWhiteSpaces(curiosityPath: string, whiteSpaces: WhiteSpace[]): void {
  const content = readFileSync(curiosityPath, 'utf-8')
  const marker = '## Network White Spaces (auto-updated)'

  // Remove previous injection if present
  const markerIdx = content.indexOf(marker)
  const base = markerIdx >= 0 ? content.slice(0, markerIdx).trimEnd() : content.trimEnd()

  if (whiteSpaces.length === 0) {
    // Nothing to inject — write back unchanged base
    writeFileSync(curiosityPath, base + '\n', 'utf-8')
    return
  }

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const lines = [
    '',
    marker,
    '',
    `_Last updated: ${timestamp} UTC_`,
    '',
    'These topic areas returned 0 results on the relay — unexplored territory.',
    'Prefer one of these as your next research focus.',
    '',
    ...whiteSpaces.map(ws => `- **${ws.query}** (0 results)`),
    '',
  ]

  writeFileSync(curiosityPath, base + '\n' + lines.join('\n'), 'utf-8')
}

/**
 * Run pulse feedback for one agent workspace.
 *
 * @param workspaceDir  Absolute path to the agent workspace directory
 * @param relayUrl      Base URL of the relay (e.g. https://relay.agentxp.io)
 */
export async function runPulseFeedback(
  workspaceDir: string,
  relayUrl: string,
): Promise<PulseFeedbackResult> {
  const curiosityPath = findCuriosityFile(workspaceDir)

  // Probe all queries in parallel (max 3 concurrent to avoid hammering relay)
  const results: WhiteSpace[] = []
  const batchSize = 3
  for (let i = 0; i < PROBE_QUERIES.length; i += batchSize) {
    const batch = PROBE_QUERIES.slice(i, i + batchSize)
    const counts = await Promise.all(batch.map(q => probeRelay(relayUrl, q)))
    for (let j = 0; j < batch.length; j++) {
      results.push({ query: batch[j]!, resultCount: counts[j]! })
    }
  }

  const whiteSpaces = results.filter(r => r.resultCount === 0)

  if (!curiosityPath) {
    return {
      whiteSpaces,
      injected: false,
      curiosityPath: null,
      message: 'CURIOSITY.md not found — white spaces identified but not injected',
    }
  }

  if (whiteSpaces.length === 0) {
    return {
      whiteSpaces: [],
      injected: false,
      curiosityPath,
      message: 'All probe queries returned results — no white spaces to inject',
    }
  }

  injectWhiteSpaces(curiosityPath, whiteSpaces)

  return {
    whiteSpaces,
    injected: true,
    curiosityPath,
    message: `Injected ${whiteSpaces.length} white space hints into CURIOSITY.md`,
  }
}
