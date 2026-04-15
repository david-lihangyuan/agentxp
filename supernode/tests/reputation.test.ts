import { describe, it, expect } from 'vitest'
import {
  calculateTrustScore,
  shouldQuarantine,
  updateReputation,
  getVisibility,
  createReputation,
  type PublisherReputation,
} from '../src/agentxp/reputation.js'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const NOW = Math.floor(Date.now() / 1000)
const DAY = 86400

function makeRep(overrides: Partial<PublisherReputation> = {}): PublisherReputation {
  return {
    pubkey: 'pk_test',
    totalPublished: 0,
    totalVerified: 0,
    trustScore: 0.0,
    firstSeenAt: NOW,
    quarantineUntilVerified: true,
    ...overrides,
  }
}

// ─────────────────────────────────────────────
// calculateTrustScore
// ─────────────────────────────────────────────

describe('calculateTrustScore', () => {
  it('returns 0 for brand-new publisher with no history and no age', () => {
    const score = calculateTrustScore({ totalPublished: 0, totalVerified: 0, ageInDays: 0 })
    expect(score).toBe(0)
  })

  it('returns small age bonus for 0 published but > 7 days old', () => {
    const score = calculateTrustScore({ totalPublished: 0, totalVerified: 0, ageInDays: 10 })
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(0.1)
  })

  it('returns 1.0 for 100% verification rate', () => {
    const score = calculateTrustScore({ totalPublished: 10, totalVerified: 10, ageInDays: 0 })
    expect(score).toBeCloseTo(1.0)
  })

  it('returns 0.5 for 50% verification rate (young account)', () => {
    const score = calculateTrustScore({ totalPublished: 10, totalVerified: 5, ageInDays: 0 })
    expect(score).toBeCloseTo(0.5)
  })

  it('adds age bonus for account older than 7 days', () => {
    const young = calculateTrustScore({ totalPublished: 10, totalVerified: 5, ageInDays: 0 })
    const old = calculateTrustScore({ totalPublished: 10, totalVerified: 5, ageInDays: 14 })
    expect(old).toBeGreaterThan(young)
  })

  it('caps age bonus at 0.1 regardless of age', () => {
    const capped = calculateTrustScore({ totalPublished: 10, totalVerified: 10, ageInDays: 9999 })
    expect(capped).toBeCloseTo(1.0) // already capped at 1.0
  })

  it('never exceeds 1.0', () => {
    const score = calculateTrustScore({ totalPublished: 5, totalVerified: 5, ageInDays: 365 })
    expect(score).toBeLessThanOrEqual(1.0)
  })

  it('never goes below 0.0', () => {
    const score = calculateTrustScore({ totalPublished: 100, totalVerified: 0, ageInDays: 0 })
    expect(score).toBeGreaterThanOrEqual(0.0)
  })

  it('is 0 for 0% verification with no age bonus', () => {
    const score = calculateTrustScore({ totalPublished: 5, totalVerified: 0, ageInDays: 0 })
    expect(score).toBe(0)
  })
})

// ─────────────────────────────────────────────
// shouldQuarantine
// ─────────────────────────────────────────────

describe('shouldQuarantine', () => {
  it('quarantines brand-new publisher (0 verified)', () => {
    expect(shouldQuarantine(makeRep({ totalVerified: 0 }))).toBe(true)
  })

  it('quarantines publisher with 1 verified', () => {
    expect(shouldQuarantine(makeRep({ totalVerified: 1 }))).toBe(true)
  })

  it('quarantines publisher with 2 verified', () => {
    expect(shouldQuarantine(makeRep({ totalVerified: 2 }))).toBe(true)
  })

  it('does NOT quarantine publisher with exactly 3 verified', () => {
    expect(shouldQuarantine(makeRep({ totalVerified: 3 }))).toBe(false)
  })

  it('does NOT quarantine publisher with 10 verified', () => {
    expect(shouldQuarantine(makeRep({ totalVerified: 10 }))).toBe(false)
  })
})

// ─────────────────────────────────────────────
// updateReputation
// ─────────────────────────────────────────────

describe('updateReputation', () => {
  it('increments totalPublished on publish event', () => {
    const rep = makeRep({ totalPublished: 2 })
    const updated = updateReputation(rep, 'publish')
    expect(updated.totalPublished).toBe(3)
  })

  it('increments totalVerified on verified event', () => {
    const rep = makeRep({ totalVerified: 2, totalPublished: 5 })
    const updated = updateReputation(rep, 'verified')
    expect(updated.totalVerified).toBe(3)
  })

  it('lifts quarantine when verified reaches 3', () => {
    const rep = makeRep({ totalVerified: 2, totalPublished: 5, quarantineUntilVerified: true })
    const updated = updateReputation(rep, 'verified')
    expect(updated.quarantineUntilVerified).toBe(false)
  })

  it('keeps quarantine when totalVerified < 3 after verified event', () => {
    const rep = makeRep({ totalVerified: 0, totalPublished: 2, quarantineUntilVerified: true })
    const updated = updateReputation(rep, 'verified')
    expect(updated.quarantineUntilVerified).toBe(true)
  })

  it('rejected event increments totalPublished (lowers ratio)', () => {
    const rep = makeRep({ totalPublished: 3, totalVerified: 3 })
    const updated = updateReputation(rep, 'rejected')
    expect(updated.totalPublished).toBe(4)
    expect(updated.totalVerified).toBe(3) // unchanged
    expect(updated.trustScore).toBeLessThan(1.0)
  })

  it('recalculates trustScore after each event', () => {
    const rep = makeRep({ totalPublished: 4, totalVerified: 2 })
    const updated = updateReputation(rep, 'verified')
    // 3/5 = 0.6
    expect(updated.trustScore).toBeGreaterThan(0)
  })

  it('preserves pubkey and firstSeenAt across updates', () => {
    const rep = makeRep({ pubkey: 'agent_xyz', firstSeenAt: NOW - DAY * 10 })
    const updated = updateReputation(rep, 'publish')
    expect(updated.pubkey).toBe('agent_xyz')
    expect(updated.firstSeenAt).toBe(NOW - DAY * 10)
  })
})

// ─────────────────────────────────────────────
// getVisibility
// ─────────────────────────────────────────────

describe('getVisibility', () => {
  it('returns quarantine for brand-new publisher', () => {
    const rep = makeRep({ totalVerified: 0, trustScore: 0.0 })
    expect(getVisibility(rep)).toBe('quarantine')
  })

  it('returns quarantine for 1-2 verified', () => {
    expect(getVisibility(makeRep({ totalVerified: 1, trustScore: 0.5 }))).toBe('quarantine')
    expect(getVisibility(makeRep({ totalVerified: 2, trustScore: 0.5 }))).toBe('quarantine')
  })

  it('returns public for 3+ verified and trustScore > 0.3', () => {
    const rep = makeRep({ totalVerified: 3, trustScore: 0.6 })
    expect(getVisibility(rep)).toBe('public')
  })

  it('returns quarantine for 3+ verified but trustScore exactly 0.3 (not > 0.3)', () => {
    const rep = makeRep({ totalVerified: 5, trustScore: 0.3 })
    expect(getVisibility(rep)).toBe('quarantine')
  })

  it('returns blocked for trustScore < 0.1 (even if verified >= 3)', () => {
    // Publisher has been around long enough to have 5 verified, but many rejections
    const rep = makeRep({ totalVerified: 5, totalPublished: 100, trustScore: 0.05 })
    expect(getVisibility(rep)).toBe('blocked')
  })

  it('returns quarantine for brand-new publisher with 0.0 trustScore (no history)', () => {
    const rep = makeRep({ totalVerified: 0, trustScore: 0.0, totalPublished: 0 })
    // No published history yet → quarantine, not blocked
    expect(getVisibility(rep)).toBe('quarantine')
  })

  it('blocked takes priority over quarantine (low score + has published history)', () => {
    // Publisher has published 20 times, only 1 verified, rest rejected → low score
    const rep = makeRep({ totalVerified: 1, totalPublished: 20, trustScore: 0.05 })
    expect(getVisibility(rep)).toBe('blocked')
  })

  it('quarantine for 3+ verified but score exactly 0.31 (edge: just above threshold)', () => {
    const rep = makeRep({ totalVerified: 3, trustScore: 0.31 })
    expect(getVisibility(rep)).toBe('public')
  })
})

// ─────────────────────────────────────────────
// createReputation
// ─────────────────────────────────────────────

describe('createReputation', () => {
  it('creates a fresh reputation with all zeroes', () => {
    const rep = createReputation('pk_new')
    expect(rep.pubkey).toBe('pk_new')
    expect(rep.totalPublished).toBe(0)
    expect(rep.totalVerified).toBe(0)
    expect(rep.trustScore).toBe(0.0)
    expect(rep.quarantineUntilVerified).toBe(true)
  })

  it('accepts a custom firstSeenAt timestamp', () => {
    const ts = NOW - DAY * 30
    const rep = createReputation('pk_old', ts)
    expect(rep.firstSeenAt).toBe(ts)
  })

  it('defaults firstSeenAt to approximately now', () => {
    const before = Math.floor(Date.now() / 1000)
    const rep = createReputation('pk_now')
    const after = Math.floor(Date.now() / 1000)
    expect(rep.firstSeenAt).toBeGreaterThanOrEqual(before)
    expect(rep.firstSeenAt).toBeLessThanOrEqual(after)
  })
})

// ─────────────────────────────────────────────
// Integration: full lifecycle
// ─────────────────────────────────────────────

describe('Reputation lifecycle', () => {
  it('new publisher goes public after 3 verifications with good score', () => {
    let rep = createReputation('pk_lifecycle')

    // Publish 3 experiences
    rep = updateReputation(rep, 'publish')
    rep = updateReputation(rep, 'publish')
    rep = updateReputation(rep, 'publish')

    // Get verified 3 times
    rep = updateReputation(rep, 'verified')
    rep = updateReputation(rep, 'verified')
    rep = updateReputation(rep, 'verified')

    expect(getVisibility(rep)).toBe('public')
    expect(rep.quarantineUntilVerified).toBe(false)
  })

  it('spammer gets blocked after many rejections', () => {
    // Start with 3 verified (got public), then many rejections
    let rep = makeRep({
      totalPublished: 3,
      totalVerified: 3,
      trustScore: 1.0,
      quarantineUntilVerified: false,
      firstSeenAt: NOW,
    })

    // 50 rejections: each increments totalPublished, ratio tanks
    for (let i = 0; i < 50; i++) {
      rep = updateReputation(rep, 'rejected')
    }

    // trustScore should be very low (3 verified / 53 published)
    expect(rep.trustScore).toBeLessThan(0.1)
    expect(getVisibility(rep)).toBe('blocked')
  })
})
