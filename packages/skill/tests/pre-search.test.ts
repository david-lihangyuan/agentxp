// Pre-Search Duplicate Check Tests
// Before publishing, search relay for similar experiences to avoid duplicates.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { createDraft, runBatchPublish, preSearchRelay } from '../src/publisher.js'
import type { DraftEntry, BatchPublishOptions } from '../src/publisher.js'

describe('Pre-Search Duplicate Check', () => {
  let testDir: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testDir = join(__dirname, '.tmp-presearch-' + id)
    mkdirSync(join(testDir, 'drafts'), { recursive: true })
    mkdirSync(join(testDir, 'published'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const sampleDraft: Pick<DraftEntry, 'what' | 'tried' | 'outcome' | 'learned'> = {
    what: 'Docker DNS resolution fails in containers',
    tried: 'modified /etc/resolv.conf and restarted container',
    outcome: 'succeeded',
    learned: 'docker container DNS cache cleared on restart, not on config reload',
  }

  it('preSearchRelay returns true when relay has a high-similarity match', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: [
          { match_score: 0.85, experience: { what: 'Docker DNS fix' } },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const draft: DraftEntry = { ...sampleDraft, retry_count: 0, last_attempt: null }
    const result = await preSearchRelay(draft, {
      relayUrl: 'wss://relay.agentxp.io',
      duplicateThreshold: 0.7,
    })

    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('preSearchRelay returns false when no high-similarity match', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: [
          { match_score: 0.3, experience: { what: 'Unrelated topic' } },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const draft: DraftEntry = { ...sampleDraft, retry_count: 0, last_attempt: null }
    const result = await preSearchRelay(draft, {
      relayUrl: 'wss://relay.agentxp.io',
      duplicateThreshold: 0.7,
    })

    expect(result).toBe(false)
  })

  it('preSearchRelay returns false when relay returns empty results', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ precision: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const draft: DraftEntry = { ...sampleDraft, retry_count: 0, last_attempt: null }
    const result = await preSearchRelay(draft, {
      relayUrl: 'wss://relay.agentxp.io',
    })

    expect(result).toBe(false)
  })

  it('preSearchRelay fails-open on network error (returns false)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'))
    vi.stubGlobal('fetch', mockFetch)

    const draft: DraftEntry = { ...sampleDraft, retry_count: 0, last_attempt: null }
    const result = await preSearchRelay(draft, {
      relayUrl: 'wss://relay.agentxp.io',
    })

    expect(result).toBe(false)
  })

  it('preSearchRelay fails-open on non-ok response (returns false)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', mockFetch)

    const draft: DraftEntry = { ...sampleDraft, retry_count: 0, last_attempt: null }
    const result = await preSearchRelay(draft, {
      relayUrl: 'wss://relay.agentxp.io',
    })

    expect(result).toBe(false)
  })

  it('Duplicate drafts are skipped and saved with dup- prefix', async () => {
    // Mock fetch: pre-search returns high match, publish would succeed
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/search')) {
        return {
          ok: true,
          json: async () => ({
            precision: [{ match_score: 0.9, experience: { what: 'Same topic' } }],
          }),
        }
      }
      // Publish endpoint (should not be reached for duplicates)
      return { ok: true, json: async () => ({ id: 'test' }) }
    })
    vi.stubGlobal('fetch', mockFetch)

    await createDraft(sampleDraft, testDir)

    const result = await runBatchPublish(testDir, {
      relayUrl: 'wss://relay.agentxp.io',
      duplicateThreshold: 0.7,
    })

    expect(result.skippedDuplicate).toBe(1)
    expect(result.published).toBe(0)

    // Draft should be in published/ with dup- prefix
    const publishedFiles = readdirSync(join(testDir, 'published'))
    expect(publishedFiles.length).toBe(1)
    expect(publishedFiles[0]).toMatch(/^dup-/)

    // Content should have relay_event_id = 'skipped-duplicate'
    const content = JSON.parse(readFileSync(join(testDir, 'published', publishedFiles[0]), 'utf8'))
    expect(content.relay_event_id).toBe('skipped-duplicate')

    // Original drafts/ should be empty
    const draftFiles = readdirSync(join(testDir, 'drafts'))
    expect(draftFiles.length).toBe(0)
  })

  it('Non-duplicate drafts proceed to publish normally', async () => {
    // Mock fetch: pre-search returns low match
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/search')) {
        return {
          ok: true,
          json: async () => ({
            precision: [{ match_score: 0.2, experience: { what: 'Different' } }],
          }),
        }
      }
      return { ok: true }
    })
    vi.stubGlobal('fetch', mockFetch)

    await createDraft(sampleDraft, testDir)

    // dryRun to skip actual signing but still run pre-search
    const result = await runBatchPublish(testDir, {
      relayUrl: 'wss://relay.agentxp.io',
      dryRun: true,
    })

    expect(result.skippedDuplicate).toBe(0)
    expect(result.published).toBe(1)
  })

  it('skipPreSearch option bypasses duplicate check entirely', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    await createDraft(sampleDraft, testDir)

    const result = await runBatchPublish(testDir, {
      relayUrl: 'wss://relay.agentxp.io',
      dryRun: true,
      skipPreSearch: true,
    })

    // fetch should NOT be called for search (only dryRun skips publish too)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.published).toBe(1)
    expect(result.skippedDuplicate).toBe(0)
  })

  it('Custom duplicateThreshold is respected', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: [{ match_score: 0.75, experience: { what: 'Similar' } }],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const draft: DraftEntry = { ...sampleDraft, retry_count: 0, last_attempt: null }

    // 0.8 threshold — 0.75 is below, should NOT be duplicate
    const notDup = await preSearchRelay(draft, {
      relayUrl: 'wss://relay.agentxp.io',
      duplicateThreshold: 0.8,
    })
    expect(notDup).toBe(false)

    // 0.7 threshold — 0.75 is above, IS duplicate
    const isDup = await preSearchRelay(draft, {
      relayUrl: 'wss://relay.agentxp.io',
      duplicateThreshold: 0.7,
    })
    expect(isDup).toBe(true)
  })

  it('preSearchRelay constructs correct search URL from wss relay URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ precision: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const draft: DraftEntry = { ...sampleDraft, retry_count: 0, last_attempt: null }
    await preSearchRelay(draft, { relayUrl: 'wss://relay.agentxp.io' })

    const calledUrl = mockFetch.mock.calls[0][0]
    expect(calledUrl).toBe('https://relay.agentxp.io/api/v1/search')
  })

  it('preSearchRelay truncates query to 300 chars', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ precision: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const longDraft: DraftEntry = {
      what: 'A'.repeat(200),
      tried: 'test',
      outcome: 'succeeded',
      learned: 'B'.repeat(200),
      retry_count: 0,
      last_attempt: null,
    }

    await preSearchRelay(longDraft, { relayUrl: 'wss://relay.agentxp.io' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.query.length).toBeLessThanOrEqual(300)
  })
})
