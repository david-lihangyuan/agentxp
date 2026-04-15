// Supernode AgentXP — Publisher Reputation System (S4)
// New publishers are auto-quarantined until independently verified by other agents.

export interface PublisherReputation {
  pubkey: string
  totalPublished: number
  totalVerified: number  // verified by other agents independently
  trustScore: number     // 0.0 - 1.0
  firstSeenAt: number    // unix timestamp (seconds)
  quarantineUntilVerified: boolean  // true = new publisher under quarantine
}

export interface TrustScoreStats {
  totalPublished: number
  totalVerified: number
  ageInDays: number
}

/**
 * Calculate trust score (0.0–1.0) based on verification rate and account age.
 * - Base: verified / max(published, 1) gives the verification ratio
 * - Age bonus: accounts older than 7 days get a small bonus (up to +0.1)
 */
export function calculateTrustScore(stats: TrustScoreStats): number {
  const { totalPublished, totalVerified, ageInDays } = stats

  if (totalPublished <= 0) {
    // Brand-new publisher, no history
    const ageBonus = ageInDays > 7 ? 0.05 : 0
    return Math.min(1.0, ageBonus)
  }

  // Verification ratio (core signal)
  const verificationRatio = totalVerified / totalPublished

  // Age bonus: max +0.1 for accounts older than 7 days, scaled by days (caps at 30 days)
  const ageBonusCap = 0.1
  const ageBonus = ageInDays > 7
    ? Math.min(ageBonusCap, ageBonusCap * Math.min(ageInDays - 7, 30) / 30)
    : 0

  const raw = verificationRatio + ageBonus
  return Math.min(1.0, Math.max(0.0, raw))
}

/**
 * Whether a publisher should be quarantined.
 * Rule: < 3 verified experiences → quarantine.
 */
export function shouldQuarantine(reputation: PublisherReputation): boolean {
  return reputation.totalVerified < 3
}

/**
 * Update reputation based on an event.
 * - 'publish': increment totalPublished, recalculate score
 * - 'verified': increment totalVerified, recalculate score, update quarantine flag
 * - 'rejected': reduce trustScore signal (penalizes spammy publishers)
 */
export function updateReputation(
  current: PublisherReputation,
  event: 'publish' | 'verified' | 'rejected'
): PublisherReputation {
  const now = Math.floor(Date.now() / 1000)
  const ageInDays = (now - current.firstSeenAt) / 86400

  let totalPublished = current.totalPublished
  let totalVerified = current.totalVerified

  if (event === 'publish') {
    totalPublished += 1
  } else if (event === 'verified') {
    totalVerified += 1
    // Also counts as a published (in case it wasn't counted yet)
    // But we don't double-count: publish events are tracked separately
  } else if (event === 'rejected') {
    // Rejection doesn't remove a verified entry; it's a negative signal
    // We model it as: increase totalPublished (the rejected item counts as published)
    // so verification ratio drops
    totalPublished += 1
  }

  const trustScore = calculateTrustScore({ totalPublished, totalVerified, ageInDays })
  const quarantineUntilVerified = totalVerified < 3

  return {
    ...current,
    totalPublished,
    totalVerified,
    trustScore,
    quarantineUntilVerified,
  }
}

/**
 * Determine visibility tier for a publisher.
 * - 'blocked':    trustScore < 0.1 AND has publishing history (spam/abuse pattern)
 *                 Brand-new publishers (0 published) go to quarantine, not blocked.
 * - 'quarantine': totalVerified < 3 (new or unverified publisher)
 * - 'public':     totalVerified >= 3 AND trustScore > 0.3
 *
 * Rationale: blocked is for publishers who *earned* a bad score through rejections.
 * A zero-history publisher has trustScore 0 by default; they belong in quarantine.
 */
export function getVisibility(reputation: PublisherReputation): 'public' | 'quarantine' | 'blocked' {
  // Only block publishers with actual history that shows abuse
  if (reputation.totalPublished > 0 && reputation.trustScore < 0.1) {
    return 'blocked'
  }
  if (reputation.totalVerified < 3 || reputation.trustScore <= 0.3) {
    return 'quarantine'
  }
  return 'public'
}

/**
 * Create a brand-new PublisherReputation for a first-seen publisher.
 */
export function createReputation(pubkey: string, firstSeenAt?: number): PublisherReputation {
  const ts = firstSeenAt ?? Math.floor(Date.now() / 1000)
  return {
    pubkey,
    totalPublished: 0,
    totalVerified: 0,
    trustScore: 0.0,
    firstSeenAt: ts,
    quarantineUntilVerified: true,
  }
}
