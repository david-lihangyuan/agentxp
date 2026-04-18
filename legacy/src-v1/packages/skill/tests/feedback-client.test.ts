// Feedback Client Tests — fetch, submit, and summarize feedback
import { describe, it, expect, afterEach, vi } from 'vitest'
import { fetchFeedback, submitFeedback, getFeedbackSummary } from '../src/feedback-client.js'
import type { FeedbackEvent, FeedbackSubmission, FeedbackSummary } from '../src/feedback-client.js'

describe('Feedback Client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const relayUrl = 'https://relay.agentxp.io'

  describe('fetchFeedback', () => {
    it('returns feedback events for a pubkey', async () => {
      const mockEvents: FeedbackEvent[] = [
        {
          id: 1,
          target_experience_id: 'exp-001',
          source_pubkey: 'src-key-abc',
          type: 'verified',
          comment: 'Confirmed this works',
          created_at: 1700000000,
        },
        {
          id: 2,
          target_experience_id: 'exp-002',
          source_pubkey: 'src-key-def',
          type: 'cited',
          created_at: 1700001000,
        },
      ]

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ feedback: mockEvents }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await fetchFeedback(relayUrl, 'my-pubkey')

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe(1)
      expect(result[0].type).toBe('verified')
      expect(result[1].type).toBe('cited')

      // Verify correct URL construction
      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/feedback')
      expect(calledUrl).toContain('pubkey=my-pubkey')
      expect(calledUrl).not.toContain('since=')
    })

    it('passes since parameter when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ feedback: [] }),
      })
      vi.stubGlobal('fetch', mockFetch)

      await fetchFeedback(relayUrl, 'my-pubkey', 1700000000)

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('pubkey=my-pubkey')
      expect(calledUrl).toContain('since=1700000000')
    })

    it('throws on non-ok response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
      vi.stubGlobal('fetch', mockFetch)

      await expect(fetchFeedback(relayUrl, 'my-pubkey')).rejects.toThrow('HTTP 500')
    })

    it('normalizes wss:// relay URL to https://', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ feedback: [] }),
      })
      vi.stubGlobal('fetch', mockFetch)

      await fetchFeedback('wss://relay.agentxp.io', 'my-pubkey')

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('https://relay.agentxp.io/api/v1/feedback')
    })
  })

  describe('submitFeedback', () => {
    const validFeedback: FeedbackSubmission = {
      target_experience_id: 'exp-001',
      source_experience_id: 'exp-100',
      type: 'verified',
      comment: 'Confirmed this pattern',
      pubkey: 'my-pubkey',
      sig: 'valid-signature-hex',
    }

    it('submits feedback successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      await expect(submitFeedback(relayUrl, validFeedback)).resolves.toBeUndefined()

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/api/v1/feedback')
      expect(opts.method).toBe('POST')
      expect(opts.headers['Content-Type']).toBe('application/json')
      const body = JSON.parse(opts.body)
      expect(body.target_experience_id).toBe('exp-001')
      expect(body.type).toBe('verified')
    })

    it('rejects contradicted feedback without comment', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const noComment: FeedbackSubmission = {
        target_experience_id: 'exp-001',
        type: 'contradicted',
        pubkey: 'my-pubkey',
        sig: 'valid-sig',
      }

      await expect(submitFeedback(relayUrl, noComment)).rejects.toThrow(
        "Feedback type 'contradicted' requires a comment"
      )
      // fetch should NOT be called
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects refined feedback without comment', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const noComment: FeedbackSubmission = {
        target_experience_id: 'exp-001',
        type: 'refined',
        comment: '',
        pubkey: 'my-pubkey',
        sig: 'valid-sig',
      }

      await expect(submitFeedback(relayUrl, noComment)).rejects.toThrow(
        "Feedback type 'refined' requires a comment"
      )
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('allows cited feedback without comment', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      const cited: FeedbackSubmission = {
        target_experience_id: 'exp-001',
        type: 'cited',
        pubkey: 'my-pubkey',
        sig: 'valid-sig',
      }

      await expect(submitFeedback(relayUrl, cited)).resolves.toBeUndefined()
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('throws on non-ok response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })
      vi.stubGlobal('fetch', mockFetch)

      await expect(submitFeedback(relayUrl, validFeedback)).rejects.toThrow('HTTP 403')
    })
  })

  describe('getFeedbackSummary', () => {
    it('returns feedback summary for an experience', async () => {
      const mockSummary: FeedbackSummary = {
        verified: 5,
        contradicted: 1,
        refined: 2,
        cited: 8,
        status: 'strengthened',
      }

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSummary,
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await getFeedbackSummary(relayUrl, 'exp-001')

      expect(result.verified).toBe(5)
      expect(result.contradicted).toBe(1)
      expect(result.refined).toBe(2)
      expect(result.cited).toBe(8)
      expect(result.status).toBe('strengthened')

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/feedback/summary/exp-001')
    })

    it('throws on non-ok response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      vi.stubGlobal('fetch', mockFetch)

      await expect(getFeedbackSummary(relayUrl, 'exp-999')).rejects.toThrow('HTTP 404')
    })
  })
})
