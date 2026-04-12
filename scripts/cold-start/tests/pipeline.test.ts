import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────
// Mocks — must be set up before imports
// ─────────────────────────────────────────────────────────────

vi.mock('../harvest.js', () => ({
  runHarvest: vi.fn(),
}))

vi.mock('../solve.js', () => ({
  runSolver: vi.fn(),
}))

vi.mock('../verify.js', () => ({
  runVerifier: vi.fn(),
}))

vi.mock('../../../packages/protocol/src/index.js', () => ({
  generateOperatorKey: vi.fn().mockResolvedValue({
    publicKey: 'mock-pubkey-1234567890abcdef',
    privateKey: new Uint8Array(32),
  }),
}))

// ─────────────────────────────────────────────────────────────
// Imports (after mocks)
// ─────────────────────────────────────────────────────────────

import { runHarvest } from '../harvest.js'
import { runSolver } from '../solve.js'
import { runVerifier } from '../verify.js'
import { runPipeline } from '../pipeline.js'

const mockRunHarvest = vi.mocked(runHarvest)
const mockRunSolver = vi.mocked(runSolver)
const mockRunVerifier = vi.mocked(runVerifier)

const RELAY_URL = 'http://localhost:3141'

describe('runPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('calls harvest, solver, and verifier in sequence', async () => {
    mockRunHarvest.mockResolvedValue({ published: 3, failed: 0 })
    mockRunSolver.mockResolvedValue({ solved: 2, failed: 1 })
    mockRunVerifier.mockResolvedValue({ passed: 1, failed: 1, errors: 0 })

    await runPipeline(RELAY_URL)

    expect(mockRunHarvest).toHaveBeenCalledOnce()
    expect(mockRunSolver).toHaveBeenCalledOnce()
    expect(mockRunVerifier).toHaveBeenCalledOnce()
  })

  it('passes correct options to harvest (tags=test, limit=3)', async () => {
    mockRunHarvest.mockResolvedValue({ published: 1, failed: 0 })
    mockRunSolver.mockResolvedValue({ solved: 0, failed: 0 })
    mockRunVerifier.mockResolvedValue({ passed: 0, failed: 0, errors: 0 })

    await runPipeline(RELAY_URL)

    expect(mockRunHarvest).toHaveBeenCalledWith({
      tags: ['test'],
      limit: 3,
      relayUrl: RELAY_URL,
    })
  })

  it('passes relay URL and operator key to solver', async () => {
    mockRunHarvest.mockResolvedValue({ published: 1, failed: 0 })
    mockRunSolver.mockResolvedValue({ solved: 1, failed: 0 })
    mockRunVerifier.mockResolvedValue({ passed: 1, failed: 0, errors: 0 })

    await runPipeline(RELAY_URL)

    expect(mockRunSolver).toHaveBeenCalledWith(
      expect.objectContaining({
        relayUrl: RELAY_URL,
        operatorKey: expect.objectContaining({
          publicKey: expect.any(String),
          privateKey: expect.any(Uint8Array),
        }),
      }),
    )
  })

  it('passes relay URL and operator key to verifier', async () => {
    mockRunHarvest.mockResolvedValue({ published: 1, failed: 0 })
    mockRunSolver.mockResolvedValue({ solved: 1, failed: 0 })
    mockRunVerifier.mockResolvedValue({ passed: 1, failed: 0, errors: 0 })

    await runPipeline(RELAY_URL)

    expect(mockRunVerifier).toHaveBeenCalledWith(
      expect.objectContaining({
        relayUrl: RELAY_URL,
        operatorKey: expect.objectContaining({
          publicKey: expect.any(String),
          privateKey: expect.any(Uint8Array),
        }),
      }),
    )
  })

  it('returns success=true when harvest publishes at least one event', async () => {
    mockRunHarvest.mockResolvedValue({ published: 2, failed: 1 })
    mockRunSolver.mockResolvedValue({ solved: 1, failed: 0 })
    mockRunVerifier.mockResolvedValue({ passed: 1, failed: 0, errors: 0 })

    const result = await runPipeline(RELAY_URL)

    expect(result.success).toBe(true)
  })

  it('returns success=false when harvest publishes zero events', async () => {
    mockRunHarvest.mockResolvedValue({ published: 0, failed: 3 })
    mockRunSolver.mockResolvedValue({ solved: 0, failed: 0 })
    mockRunVerifier.mockResolvedValue({ passed: 0, failed: 0, errors: 0 })

    const result = await runPipeline(RELAY_URL)

    expect(result.success).toBe(false)
  })

  it('aggregates stats from all three steps correctly', async () => {
    mockRunHarvest.mockResolvedValue({ published: 3, failed: 1 })
    mockRunSolver.mockResolvedValue({ solved: 2, failed: 1 })
    mockRunVerifier.mockResolvedValue({ passed: 1, failed: 1, errors: 0 })

    const result = await runPipeline(RELAY_URL)

    expect(result.stats).toEqual({
      harvest: { published: 3, failed: 1 },
      solver: { solved: 2, failed: 1 },
      verifier: { passed: 1, failed: 1, errors: 0 },
    })
  })

  it('still runs solver and verifier even when harvest has failures', async () => {
    mockRunHarvest.mockResolvedValue({ published: 1, failed: 2 })
    mockRunSolver.mockResolvedValue({ solved: 1, failed: 0 })
    mockRunVerifier.mockResolvedValue({ passed: 1, failed: 0, errors: 0 })

    const result = await runPipeline(RELAY_URL)

    expect(mockRunSolver).toHaveBeenCalledOnce()
    expect(mockRunVerifier).toHaveBeenCalledOnce()
    expect(result.success).toBe(true)
  })
})
