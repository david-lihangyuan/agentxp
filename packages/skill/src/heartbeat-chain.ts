// Heartbeat Chain — Session continuity across Agent restarts
// Manages heartbeat-chain.md with an 800-token hard cap.
// Oldest entries auto-compressed to 1-sentence summaries on overflow.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { estimateTokens } from './utils.js'

const TOKEN_HARD_CAP = 800

export interface HeartbeatEntry {
  date: string
  content: string
  compressed: boolean
}

/**
 * Parse heartbeat-chain.md into individual entries.
 * Each entry is a ## section. The file header (# Heartbeat Chain) is skipped.
 */
export function parseHeartbeatChain(raw: string): HeartbeatEntry[] {
  const entries: HeartbeatEntry[] = []
  const sections = raw.split(/^## /m).filter(s => s.trim())

  for (const section of sections) {
    const lines = section.split('\n')
    const dateLine = lines[0]?.trim() || ''

    const content = lines.slice(1).join('\n').trim()
    const fullText = dateLine + '\n' + content

    // Skip file header fragments ("# Heartbeat Chain" leaks into first section)
    if (/^#\s|^heartbeat chain$/i.test(dateLine.trim())) continue

    // Try to extract a date from the heading or from content lines
    const dateMatch = dateLine.match(/(\d{4}-\d{2}-\d{2})/) ||
      content.match(/(\d{4}-\d{2}-\d{2})/)
    const date = dateMatch ? dateMatch[1] : dateLine
    entries.push({
      date,
      content: content || dateLine,
      compressed: false,
    })
  }

  return entries
}

/**
 * Compress an entry to a single summary sentence.
 * Extracts the most meaningful sentence and ensures it ends with a period.
 */
export function compressEntry(entry: HeartbeatEntry): HeartbeatEntry {
  const text = entry.content
  // Try to extract the first sentence that contains substance
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10)

  let summary: string
  if (sentences.length > 0) {
    // Pick the first substantial sentence
    summary = sentences[0].trim()
    // Ensure it ends with a period
    if (!summary.endsWith('.')) {
      summary += '.'
    }
  } else {
    // Fallback: take first 150 chars and add period
    summary = text.slice(0, 150).trim()
    if (!summary.endsWith('.')) {
      summary += '.'
    }
  }

  return {
    date: entry.date,
    content: summary,
    compressed: true,
  }
}

/**
 * Serialize entries back to heartbeat-chain.md format.
 */
function serializeChain(entries: HeartbeatEntry[]): string {
  if (entries.length === 0) return '# Heartbeat Chain\n'

  let result = '# Heartbeat Chain\n\n'
  for (const entry of entries) {
    result += `## ${entry.date}\n${entry.content}\n\n`
  }
  return result.trimEnd() + '\n'
}

/**
 * Write a fresh heartbeat chain entry, replacing all existing content.
 * Still respects the 800-token cap.
 */
export async function writeHeartbeatChain(
  content: string,
  reflectionDir?: string
): Promise<void> {
  const dir = reflectionDir || join(process.cwd(), 'reflection')
  mkdirSync(dir, { recursive: true })
  const chainPath = join(dir, 'heartbeat-chain.md')

  const date = new Date().toISOString().slice(0, 10)
  const entry: HeartbeatEntry = { date, content, compressed: false }
  let entries = [entry]

  // Enforce token cap
  entries = enforceTokenCap(entries)

  writeFileSync(chainPath, serializeChain(entries))
}

/**
 * Append a new entry to heartbeat-chain.md.
 * Auto-compresses oldest entries if total exceeds 800 tokens.
 */
export async function appendHeartbeatChain(
  content: string,
  reflectionDir?: string
): Promise<void> {
  const dir = reflectionDir || join(process.cwd(), 'reflection')
  mkdirSync(dir, { recursive: true })
  const chainPath = join(dir, 'heartbeat-chain.md')

  let entries: HeartbeatEntry[] = []
  if (existsSync(chainPath)) {
    const existing = readFileSync(chainPath, 'utf8')
    entries = parseHeartbeatChain(existing)
  }

  const date = new Date().toISOString().slice(0, 10)
  entries.push({ date, content, compressed: false })

  // Enforce token cap
  entries = enforceTokenCap(entries)

  writeFileSync(chainPath, serializeChain(entries))
}

/**
 * Enforce the 800-token hard cap by compressing oldest entries.
 * Compresses one entry at a time from the oldest until under cap.
 * If a single entry exceeds the cap, it gets compressed.
 */
function enforceTokenCap(entries: HeartbeatEntry[]): HeartbeatEntry[] {
  let serialized = serializeChain(entries)
  let tokens = estimateTokens(serialized)

  while (tokens > TOKEN_HARD_CAP && entries.length > 0) {
    // Find oldest uncompressed entry
    const oldestUncompressedIdx = entries.findIndex(e => !e.compressed)
    if (oldestUncompressedIdx >= 0) {
      entries[oldestUncompressedIdx] = compressEntry(entries[oldestUncompressedIdx])
    } else {
      // All entries are compressed but still over cap — remove oldest
      entries.shift()
    }
    serialized = serializeChain(entries)
    tokens = estimateTokens(serialized)
  }

  return entries
}

/**
 * Extract the oldest entry from a heartbeat chain string.
 * Useful for inspecting compressed entries.
 */
export function extractOldestEntry(chainContent: string): string {
  const entries = parseHeartbeatChain(chainContent)
  if (entries.length === 0) return ''
  return entries[0].content
}
