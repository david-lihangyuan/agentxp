import { describe, it, expect } from 'vitest'
import { nextAttemptDelay } from '../src/backoff.js'

describe('nextAttemptDelay (SPEC 03-modules-product §3 reference)', () => {
  it('starts at the 15-minute base on the first retry with zero jitter', () => {
    const delay = nextAttemptDelay(0, { random: () => 0.5 })
    expect(delay).toBe(15 * 60)
  })

  it('doubles each retry until the 60-minute cap', () => {
    const r = () => 0.5 // zero jitter
    expect(nextAttemptDelay(0, { random: r })).toBe(15 * 60)
    expect(nextAttemptDelay(1, { random: r })).toBe(30 * 60)
    expect(nextAttemptDelay(2, { random: r })).toBe(60 * 60)
    expect(nextAttemptDelay(3, { random: r })).toBe(60 * 60)
  })

  it('applies ±jitterRatio jitter within tolerance', () => {
    const low = nextAttemptDelay(0, { random: () => 0 })
    const high = nextAttemptDelay(0, { random: () => 1 })
    expect(low).toBeLessThan(15 * 60)
    expect(high).toBeGreaterThan(15 * 60)
    expect(low).toBeGreaterThanOrEqual(15 * 60 * 0.8 - 1)
    expect(high).toBeLessThanOrEqual(15 * 60 * 1.2 + 1)
  })
})
