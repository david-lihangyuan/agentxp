// Plugin v3 uses the SDK retry contract from SPEC 01-interfaces §6
// (NOT the Skill-specific 15 min / 60 min backoff in §3).
//   base 1 s, factor 2, jitter ±20 %, cap 60 s, ≤5 attempts.
const BASE_SECONDS = 1
const CAP_SECONDS = 60
const JITTER_RATIO = 0.2
export const MAX_ATTEMPTS = 5

export interface SdkBackoffOptions {
  baseSeconds?: number
  capSeconds?: number
  jitterRatio?: number
  random?: () => number
}

export function sdkNextAttemptDelay(
  retryCount: number,
  opts: SdkBackoffOptions = {},
): number {
  const base = opts.baseSeconds ?? BASE_SECONDS
  const cap = opts.capSeconds ?? CAP_SECONDS
  const jr = opts.jitterRatio ?? JITTER_RATIO
  const rng = opts.random ?? Math.random

  const raw = Math.min(base * Math.pow(2, Math.max(0, retryCount)), cap)
  const jitter = raw * jr * (rng() * 2 - 1)
  return Math.max(1, Math.floor(raw + jitter))
}
