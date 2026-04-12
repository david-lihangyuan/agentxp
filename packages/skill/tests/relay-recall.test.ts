// Relay Recall Tests — Pre-publish search that surfaces related experiences
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { relayRecall } from '../src/relay-recall.js'
import type { RecallOptions, RecallResult } from '../src/relay-recall.js'

describe('Relay Recall', () => {
  let testHome: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testHome = join(__dirname, '.tmp-recall-' + id)
    mkdirSync(join(testHome, '.agentxp', 'identity'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const baseOptions: RecallOptions = {
    relayUrl: 'https://relay.agentxp.io',
  }

  it('returns related experiences when relay has matches', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: [
          {
            match_score: 0.65,
            experience: {
              id: 42,
              what: 'Docker DNS resolution fails',
              tried: 'modified resolv.conf',
              outcome: 'succeeded',
              learned: 'DNS cache cleared on restart',
              operator_pubkey: 'abc123',
              tags: '["docker","dns"]',
            },
          },
          {
            match_score: 0.45,
            experience: {
              id: 43,
              what: 'Container networking issues',
              tried: 'bridge network reset',
              outcome: 'failed',
              learned: 'Bridge reset alone is insufficient',
              operator_pubkey: 'def456',
              tags: '[]',
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall(
      'Docker container DNS not resolving',
      'Need to check if this is a cache or config issue',
      baseOptions
    )

    expect(result.success).toBe(true)
    expect(result.count).toBe(2)
    expect(result.related).toHaveLength(2)
    expect(result.related[0].id).toBe(42)
    expect(result.related[0].match_score).toBe(0.65)
    expect(result.formatted).toContain('2 related experience(s) found')
    expect(result.formatted).toContain('<external_experience')
    expect(result.formatted).toContain('Docker DNS resolution fails')
  })

  it('filters out experiences below minScore', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: [
          { match_score: 0.5, experience: { id: 1, what: 'High match', tried: '', outcome: 'succeeded', learned: 'yes', operator_pubkey: null, tags: '[]' } },
          { match_score: 0.2, experience: { id: 2, what: 'Low match', tried: '', outcome: 'failed', learned: 'no', operator_pubkey: null, tags: '[]' } },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall('test topic', 'test lesson', {
      ...baseOptions,
      minScore: 0.4,
    })

    expect(result.count).toBe(1)
    expect(result.related[0].what).toBe('High match')
  })

  it('excludes own operator experiences when pubkey is known', async () => {
    const ownPubkey = 'my-operator-pubkey-abc'
    writeFileSync(join(testHome, '.agentxp', 'identity', 'operator.pub'), ownPubkey + '\n')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: [
          { match_score: 0.7, experience: { id: 1, what: 'My own experience', tried: '', outcome: 'succeeded', learned: 'self', operator_pubkey: ownPubkey, tags: '[]' } },
          { match_score: 0.6, experience: { id: 2, what: 'Other agent experience', tried: '', outcome: 'failed', learned: 'other', operator_pubkey: 'other-key', tags: '[]' } },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall('test', 'test', {
      ...baseOptions,
      agentHomeDir: testHome,
    })

    expect(result.count).toBe(1)
    expect(result.related[0].what).toBe('Other agent experience')
  })

  it('returns empty when no matches found', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ precision: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall('unique topic', 'unique lesson', baseOptions)

    expect(result.success).toBe(true)
    expect(result.count).toBe(0)
    expect(result.formatted).toContain('no related experiences found')
    expect(result.formatted).toContain('You are exploring new territory')
  })

  it('fails-open on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall('test', 'test', baseOptions)

    expect(result.success).toBe(false)
    expect(result.count).toBe(0)
    expect(result.formatted).toContain('timed out or network error')
  })

  it('fails-open on non-ok HTTP response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall('test', 'test', baseOptions)

    expect(result.success).toBe(false)
    expect(result.formatted).toContain('HTTP 503')
  })

  it('respects limit option', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: Array.from({ length: 10 }, (_, i) => ({
          match_score: 0.9 - i * 0.05,
          experience: { id: i, what: `Experience ${i}`, tried: '', outcome: 'succeeded', learned: 'lesson', operator_pubkey: `key-${i}`, tags: '[]' },
        })),
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall('test', 'test', {
      ...baseOptions,
      limit: 3,
    })

    expect(result.count).toBe(3)
    expect(result.related).toHaveLength(3)
  })

  it('normalizes wss:// URL to https://', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ precision: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await relayRecall('test', 'test', {
      relayUrl: 'wss://relay.agentxp.io',
    })

    const calledUrl = mockFetch.mock.calls[0][0]
    expect(calledUrl).toBe('https://relay.agentxp.io/api/v1/search')
  })

  it('formats failed experiences with ❌ marker', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: [
          { match_score: 0.6, experience: { id: 1, what: 'Failed attempt', tried: '', outcome: 'failed', learned: 'do not do this', operator_pubkey: null, tags: '[]' } },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall('test', 'test', baseOptions)

    expect(result.formatted).toContain('❌ failed')
  })

  it('formats succeeded experiences with ✅ marker', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: [
          { match_score: 0.6, experience: { id: 1, what: 'Good attempt', tried: '', outcome: 'succeeded', learned: 'it works', operator_pubkey: null, tags: '[]' } },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall('test', 'test', baseOptions)

    expect(result.formatted).toContain('✅ succeeded')
  })

  it('formatted output includes consideration prompts', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        precision: [
          { match_score: 0.5, experience: { id: 1, what: 'Test', tried: '', outcome: 'succeeded', learned: 'yes', operator_pubkey: null, tags: '[]' } },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await relayRecall('test', 'test', baseOptions)

    expect(result.formatted).toContain('Does your experience ADD something')
    expect(result.formatted).toContain('CONTRADICT or REFINE')
    expect(result.formatted).toContain('CONFIRM a pattern')
    expect(result.formatted).toContain('merely RESTATES')
  })

  it('builds query from what + learned, truncated appropriately', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ precision: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const longWhat = 'A'.repeat(100)
    const longLearned = 'B'.repeat(200)

    await relayRecall(longWhat, longLearned, baseOptions)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.query.length).toBeLessThanOrEqual(200)
    // Should start with the 'what' content
    expect(body.query.startsWith(longWhat)).toBe(true)
  })
})
