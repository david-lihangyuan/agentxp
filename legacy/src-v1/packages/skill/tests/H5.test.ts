// H5: Pulse Feedback tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runPulseFeedback } from '../src/pulse-feedback'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempWorkspace(curiosityContent?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentxp-h5-'))
  if (curiosityContent !== undefined) {
    writeFileSync(join(dir, 'CURIOSITY.md'), curiosityContent, 'utf-8')
  }
  return dir
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('H5: runPulseFeedback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns white spaces when relay returns 0 results', async () => {
    // Stub fetch: always return 0 results
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    }))

    const dir = makeTempWorkspace('# CURIOSITY.md\n\n## Active threads\n\n1. Test thread\n')
    try {
      const result = await runPulseFeedback(dir, 'https://relay.example.com')
      expect(result.whiteSpaces.length).toBeGreaterThan(0)
      expect(result.injected).toBe(true)
      expect(result.curiosityPath).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('injects white space section into CURIOSITY.md', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    }))

    const initial = '# CURIOSITY.md\n\n## Active threads\n\n1. Some thread\n'
    const dir = makeTempWorkspace(initial)
    try {
      await runPulseFeedback(dir, 'https://relay.example.com')
      const content = readFileSync(join(dir, 'CURIOSITY.md'), 'utf-8')
      expect(content).toContain('## Network White Spaces (auto-updated)')
      expect(content).toContain('0 results')
      // Original content preserved
      expect(content).toContain('## Active threads')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('replaces previous white space section on re-run', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    }))

    const initial = [
      '# CURIOSITY.md',
      '',
      '## Active threads',
      '',
      '1. Some thread',
      '',
      '## Network White Spaces (auto-updated)',
      '',
      '_Last updated: 2026-01-01 00:00 UTC_',
      '',
      '- **old query** (0 results)',
      '',
    ].join('\n')

    const dir = makeTempWorkspace(initial)
    try {
      await runPulseFeedback(dir, 'https://relay.example.com')
      const content = readFileSync(join(dir, 'CURIOSITY.md'), 'utf-8')
      // Should not have duplicate sections
      const occurrences = (content.match(/## Network White Spaces/g) || []).length
      expect(occurrences).toBe(1)
      // Old content gone
      expect(content).not.toContain('old query')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('returns injected=false when CURIOSITY.md does not exist', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    }))

    const dir = makeTempWorkspace() // no CURIOSITY.md
    try {
      const result = await runPulseFeedback(dir, 'https://relay.example.com')
      expect(result.injected).toBe(false)
      expect(result.curiosityPath).toBeNull()
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('returns injected=false when all queries have results', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ results: [{ id: 'x' }] }),
    }))

    const dir = makeTempWorkspace('# CURIOSITY.md\n\n## Active threads\n\n1. Some thread\n')
    try {
      const result = await runPulseFeedback(dir, 'https://relay.example.com')
      expect(result.whiteSpaces).toHaveLength(0)
      expect(result.injected).toBe(false)
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('handles fetch errors gracefully (result count = -1, treated as non-white-space)', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network error') })

    const dir = makeTempWorkspace('# CURIOSITY.md\n\n## Active threads\n')
    try {
      const result = await runPulseFeedback(dir, 'https://relay.example.com')
      // All errored (-1), none are 0 → no white spaces
      expect(result.whiteSpaces).toHaveLength(0)
      expect(result.injected).toBe(false)
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})
