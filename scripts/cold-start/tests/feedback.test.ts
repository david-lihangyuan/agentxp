import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchVerificationResults,
  processPassResult,
  processFailResult,
} from '../feedback.js'
import { generateOperatorKey } from '../../../packages/protocol/src/index.js'

const RELAY_URL = 'https://relay.example.com'

describe('fetchVerificationResults', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches both pass and fail results and merges them', async () => {
    const passResults = [{ event_id: 'pass1', status: 'verified_pass' }]
    const failResults = [{ event_id: 'fail1', status: 'verified_fail' }]

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('status=verified_pass')) {
          return { ok: true, json: () => Promise.resolve(passResults) }
        }
        if (url.includes('status=verified_fail')) {
          return { ok: true, json: () => Promise.resolve(failResults) }
        }
        return { ok: true, json: () => Promise.resolve([]) }
      }),
    )

    const results = await fetchVerificationResults(RELAY_URL, 10)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledWith(
      `${RELAY_URL}/api/cold-start/questions?status=verified_pass&limit=10`,
    )
    expect(fetch).toHaveBeenCalledWith(
      `${RELAY_URL}/api/cold-start/questions?status=verified_fail&limit=10`,
    )
    expect(results).toEqual([...passResults, ...failResults])
  })

  it('fetches without limit when not specified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      }),
    )

    await fetchVerificationResults(RELAY_URL)

    expect(fetch).toHaveBeenCalledWith(
      `${RELAY_URL}/api/cold-start/questions?status=verified_pass`,
    )
    expect(fetch).toHaveBeenCalledWith(
      `${RELAY_URL}/api/cold-start/questions?status=verified_fail`,
    )
  })

  it('throws on non-ok pass response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('verified_pass')) {
          return { ok: false, status: 500 }
        }
        return { ok: true, json: () => Promise.resolve([]) }
      }),
    )

    await expect(fetchVerificationResults(RELAY_URL)).rejects.toThrow(
      'Failed to fetch pass results: HTTP 500',
    )
  })
})

describe('processPassResult', () => {
  let operatorKey: { publicKey: string; privateKey: Uint8Array }
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = []

  beforeEach(async () => {
    vi.restoreAllMocks()
    fetchCalls.length = 0
    operatorKey = await generateOperatorKey()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init })
        return { ok: true, status: 200 }
      }),
    )
  })

  it('updates solution status to verified and calls experience verify API', async () => {
    const result = {
      event_id: 'evt_pass_001',
      payload: {
        type: 'verification.pass',
        data: { solution_id: 'sol_001' },
      },
    }

    const config = { relayUrl: RELAY_URL, operatorKey }
    await processPassResult(result, config)

    // Should call status update API
    const statusCall = fetchCalls.find((c) =>
      c.url.includes('/api/cold-start/events/status'),
    )
    expect(statusCall).toBeDefined()
    const statusBody = JSON.parse(statusCall!.init?.body as string)
    expect(statusBody.event_id).toBe('sol_001')
    expect(statusBody.status).toBe('verified')

    // Should call experience verify API
    const verifyCall = fetchCalls.find((c) =>
      c.url.includes('/api/experiences/evt_pass_001/verify'),
    )
    expect(verifyCall).toBeDefined()
    expect(verifyCall!.init?.method).toBe('POST')
  })
})

describe('processFailResult', () => {
  let operatorKey: { publicKey: string; privateKey: Uint8Array }
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = []

  beforeEach(async () => {
    vi.restoreAllMocks()
    fetchCalls.length = 0
    operatorKey = await generateOperatorKey()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init })
        // Return ok:true for publishEvent calls (POST /api/events)
        if (url.includes('/api/events')) {
          return { ok: true, status: 200, statusText: 'OK' }
        }
        return { ok: true, status: 200 }
      }),
    )
  })

  it('updates solution status to failed and retries when retry_count is 0', async () => {
    const result = {
      event_id: 'evt_fail_001',
      payload: {
        type: 'verification.fail',
        data: {
          solution_id: 'sol_fail_001',
          question_text: 'How do I parse JSON?',
          retry_count: 0,
        },
      },
    }

    const config = { relayUrl: RELAY_URL, operatorKey }
    const retried = await processFailResult(result, config)

    expect(retried).toBe(true)

    // Should call status update API with 'failed'
    const statusCall = fetchCalls.find((c) =>
      c.url.includes('/api/cold-start/events/status'),
    )
    expect(statusCall).toBeDefined()
    const statusBody = JSON.parse(statusCall!.init?.body as string)
    expect(statusBody.event_id).toBe('sol_fail_001')
    expect(statusBody.status).toBe('failed')

    // Should publish a new intent.question event (retry)
    const publishCall = fetchCalls.find((c) => c.url.includes('/api/events'))
    expect(publishCall).toBeDefined()
    const eventBody = JSON.parse(publishCall!.init?.body as string)
    expect(eventBody.kind).toBe('intent.question')
    expect(eventBody.payload.data.retry_count).toBe(1)
    expect(eventBody.payload.data.question).toBe('How do I parse JSON?')
    expect(eventBody.payload.data.original_solution_id).toBe('sol_fail_001')
  })

  it('does not retry when retry_count >= 1', async () => {
    const result = {
      event_id: 'evt_fail_002',
      payload: {
        type: 'verification.fail',
        data: {
          solution_id: 'sol_fail_002',
          question_text: 'How do I sort an array?',
          retry_count: 1,
        },
      },
    }

    const config = { relayUrl: RELAY_URL, operatorKey }
    const retried = await processFailResult(result, config)

    expect(retried).toBe(false)

    // Should still update status to 'failed'
    const statusCall = fetchCalls.find((c) =>
      c.url.includes('/api/cold-start/events/status'),
    )
    expect(statusCall).toBeDefined()

    // Should NOT publish a new intent.question event
    const publishCall = fetchCalls.find((c) => c.url.includes('/api/events'))
    expect(publishCall).toBeUndefined()
  })

  it('does not retry when retry_count is greater than 1', async () => {
    const result = {
      event_id: 'evt_fail_003',
      payload: {
        type: 'verification.fail',
        data: {
          solution_id: 'sol_fail_003',
          question_text: 'What is a closure?',
          retry_count: 5,
        },
      },
    }

    const config = { relayUrl: RELAY_URL, operatorKey }
    const retried = await processFailResult(result, config)

    expect(retried).toBe(false)

    // Should NOT publish a retry event
    const publishCall = fetchCalls.find((c) => c.url.includes('/api/events'))
    expect(publishCall).toBeUndefined()
  })
})
