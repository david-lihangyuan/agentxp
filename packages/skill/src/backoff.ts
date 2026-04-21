// Skill-specific retry backoff (SPEC 03-modules-product §3 reference):
// 15-minute base, doubling, 60-minute cap. Jitter is bounded so tests
// remain deterministic when given a stable random source.
const BASE_SECONDS = 15 * 60
const CAP_SECONDS = 60 * 60
const JITTER_RATIO = 0.2

export interface BackoffOptions {
  baseSeconds?: number
  capSeconds?: number
  jitterRatio?: number
  random?: () => number
}

export function nextAttemptDelay(retryCount: number, opts: BackoffOptions = {}): number {
  const base = opts.baseSeconds ?? BASE_SECONDS
  const cap = opts.capSeconds ?? CAP_SECONDS
  const jr = opts.jitterRatio ?? JITTER_RATIO
  const rng = opts.random ?? Math.random

  const raw = Math.min(base * Math.pow(2, Math.max(0, retryCount)), cap)
  const jitter = raw * jr * (rng() * 2 - 1)
  return Math.max(1, Math.floor(raw + jitter))
}
