import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SerendipEvent } from '../../../packages/protocol/src/types.js'

// ─────────────────────────────────────────────────────────────
// Mocks — must be set up before imports
// ─────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('Mock Claude solution output'),
}))

vi.mock('../publish.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
  }
})

// ─────────────────────────────────────────────────────────────
// Imports (after mocks)
// ─────────────────────────────────────────────────────────────

import { execSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { publishEvent } from '../publish.js'
import { fetchPendingQuestions, solveQuestion } from '../solve.js'
import type { SolverConfig } from '../solve.js'

const RELAY_URL = 'https://relay.example.com'

const mockQuestion = {
  event_id: 'abc12345deadbeef',
  kind: 'intent.question',
  pubkey: 'aabbccdd',
  created_at: 1712880000,
  payload: JSON.stringify({
    type: 'intent.question',
    data: {
      title: 'How to fix Docker networking issue?',
      body: 'My containers cannot reach the internet.',
      tags: ['docker', 'networking'],
    },
  }),
  tags: '["docker","networking"]',
  sig: 'fakesig',
  status: 'pending',
  received_at: 1712880001,
}

describe('fetchPendingQuestions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls the relay API with status=pending', async () => {
    const mockQuestions = [mockQuestion]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ questions: mockQuestions }),
      }),
    )

    const result = await fetchPendingQuestions(RELAY_URL)

    expect(fetch).toHaveBeenCalledWith(
      `${RELAY_URL}/api/cold-start/questions?status=pending`,
    )
    expect(result).toEqual(mockQuestions)
  })

  it('appends limit parameter when provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ questions: [] }),
      }),
    )

    await fetchPendingQuestions(RELAY_URL, 5)

    expect(fetch).toHaveBeenCalledWith(
      `${RELAY_URL}/api/cold-start/questions?status=pending&limit=5`,
    )
  })

  it('throws on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    )

    await expect(fetchPendingQuestions(RELAY_URL)).rejects.toThrow(
      'Failed to fetch questions: HTTP 500',
    )
  })
})

describe('solveQuestion', () => {
  let config: SolverConfig

  beforeEach(async () => {
    vi.restoreAllMocks()
    // Re-mock after restoreAllMocks
    vi.mocked(execSync).mockReturnValue('Mock Claude solution output')
    vi.mocked(publishEvent).mockResolvedValue({ ok: true })
    vi.mocked(mkdirSync).mockReturnValue(undefined)
    vi.mocked(rmSync).mockReturnValue(undefined)

    const { generateOperatorKey } = await import(
      '../../../packages/protocol/src/index.js'
    )
    const operatorKey = await generateOperatorKey()
    config = { relayUrl: RELAY_URL, operatorKey }
  })

  it('invokes claude CLI and publishes a solution event on success', async () => {
    const result = await solveQuestion(mockQuestion, config)

    expect(result).toEqual({ ok: true })

    // Claude was invoked
    expect(execSync).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(execSync).mock.calls[0]
    expect(callArgs[0]).toContain('claude -p')
    expect(callArgs[0]).toContain('--max-turns 5')
    expect(callArgs[0]).toContain('--dangerously-skip-permissions')
    // Working directory is a temp dir based on event_id prefix
    expect((callArgs[1] as { cwd: string }).cwd).toContain('agentxp-solve-abc12345')

    // publishEvent was called with a signed SerendipEvent
    expect(publishEvent).toHaveBeenCalledOnce()
    const [publishedEvent, publishedUrl] = vi.mocked(publishEvent).mock.calls[0]
    expect(publishedUrl).toBe(RELAY_URL)

    const event = publishedEvent as SerendipEvent
    expect(event.id).toBeDefined()
    expect(event.sig).toBeDefined()
    expect(event.pubkey).toBe(config.operatorKey.publicKey)
    expect(event.kind).toBe('experience.solution')
    expect(event.payload.type).toBe('experience.solution')
    expect((event.payload.data as { question_id: string }).question_id).toBe(
      mockQuestion.event_id,
    )
    expect((event.payload.data as { solution: string }).solution).toBe(
      'Mock Claude solution output',
    )
  })

  it('cleans up temp directory after success', async () => {
    await solveQuestion(mockQuestion, config)

    expect(rmSync).toHaveBeenCalledWith(
      expect.stringContaining('agentxp-solve-abc12345'),
      { recursive: true, force: true },
    )
  })

  it('returns error and cleans up when claude fails', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('claude command not found')
    })

    const result = await solveQuestion(mockQuestion, config)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Claude invocation failed')
    expect(result.error).toContain('claude command not found')

    // Temp dir still cleaned up
    expect(rmSync).toHaveBeenCalled()
  })

  it('returns error when publish fails', async () => {
    vi.mocked(publishEvent).mockResolvedValue({
      ok: false,
      error: 'HTTP 500: Internal Server Error',
    })

    const result = await solveQuestion(mockQuestion, config)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Publish failed')
  })
})
