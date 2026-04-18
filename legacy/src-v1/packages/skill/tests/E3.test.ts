// E3 Test Suite: Heartbeat Continuity
// TDD: heartbeat-chain.md management with 800-token hard cap, auto-compression.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import {
  writeHeartbeatChain,
  appendHeartbeatChain,
  extractOldestEntry,
} from '../src/heartbeat-chain.js'
import { estimateTokens } from '../src/utils.js'

describe('E3: Heartbeat Continuity', () => {
  let testDir: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testDir = join(__dirname, '.tmp-e3-' + id)
    mkdirSync(join(testDir, 'reflection'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  const reflectionDir = () => join(testDir, 'reflection')

  it('heartbeat-chain.md updated after session', async () => {
    await writeHeartbeatChain('session 1 did X and discovered Y', reflectionDir())
    const chain = readFileSync(join(reflectionDir(), 'heartbeat-chain.md'), 'utf8')
    expect(chain).toContain('session 1 did X')
  })

  it('Hard cap at 800 tokens — overflow auto-compresses oldest entry', async () => {
    // Write a very long entry that exceeds 800 tokens (~3200 chars)
    const longEntry = 'This is a detailed entry about a complex debugging session where we discovered multiple issues. '.repeat(40)
    await appendHeartbeatChain(longEntry, reflectionDir())
    const after = readFileSync(join(reflectionDir(), 'heartbeat-chain.md'), 'utf8')
    expect(estimateTokens(after)).toBeLessThanOrEqual(800)
  })

  it('Compressed entry is a 1-sentence summary, not truncated mid-word', async () => {
    // First add a meaningful entry
    await writeHeartbeatChain(
      'Investigated Docker networking issue. Found that DNS cache persists across config reloads. Container restart clears the cache properly.',
      reflectionDir()
    )
    // Then add a very long entry to force compression of the first
    const longEntry = 'Working on implementing the new authentication system with OAuth2 flow including token refresh and session management. '.repeat(30)
    await appendHeartbeatChain(longEntry, reflectionDir())

    const after = readFileSync(join(reflectionDir(), 'heartbeat-chain.md'), 'utf8')
    const entries = after.split(/^## /m).filter(s => s.trim())

    // The oldest entry (first in the split) should be compressed
    // Find the compressed entry - it should be shorter than original
    const oldestContent = extractOldestEntry(after)
    expect(oldestContent.endsWith('.')).toBe(true)
    expect(oldestContent.length).toBeGreaterThan(20)
    expect(oldestContent.length).toBeLessThan(200)
  })
})
