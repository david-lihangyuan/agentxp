// SDK retry contract from SPEC 01-interfaces §6 applied to Plugin v3
// (NOT the Skill-specific 15 min backoff in §3).
import { describe, it, expect } from 'vitest'
import { sdkNextAttemptDelay, MAX_ATTEMPTS } from '../src/backoff.js'

describe('sdkNextAttemptDelay', () => {
  it('base 1 s on the first retry (zero jitter RNG returns 0.5)', () => {
    // rng=0.5 -> (2*0.5-1)=0 -> no jitter
    expect(sdkNextAttemptDelay(0, { random: () => 0.5 })).toBe(1)
    expect(sdkNextAttemptDelay(1, { random: () => 0.5 })).toBe(2)
    expect(sdkNextAttemptDelay(2, { random: () => 0.5 })).toBe(4)
  })

  it('caps at 60 s', () => {
    expect(sdkNextAttemptDelay(30, { random: () => 0.5 })).toBe(60)
  })

  it('applies ±20 % jitter', () => {
    const low = sdkNextAttemptDelay(3, { random: () => 0 }) // -20 %
    const high = sdkNextAttemptDelay(3, { random: () => 1 }) // +20 %
    expect(low).toBeLessThan(8)
    expect(high).toBeGreaterThan(8)
  })

  it('MAX_ATTEMPTS equals 5 per SPEC §6', () => {
    expect(MAX_ATTEMPTS).toBe(5)
  })
})
