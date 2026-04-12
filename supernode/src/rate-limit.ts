// Supernode — Rate Limiter
// Per-IP (100 req/min), per-pubkey (50 req/min), global WebSocket cap (1000).
// Token bucket algorithm with sliding window.

export interface RateLimiterOptions {
  /** Window duration in milliseconds. Default: 60000 (1 minute) */
  windowMs?: number
  /** Max requests per IP per window. Default: 100 */
  perIpLimit?: number
  /** Max requests per pubkey per window. Default: 50 */
  perPubkeyLimit?: number
  /** Max concurrent WebSocket connections globally. Default: 1000 */
  maxConnections?: number
  /** Max concurrent WebSocket connections per operator pubkey. Default: 10 */
  maxConnectionsPerOperator?: number
}

interface Bucket {
  count: number
  windowStart: number
}

export class RateLimiter {
  private windowMs: number
  private perIpLimit: number
  private perPubkeyLimit: number
  private ipBuckets: Map<string, Bucket> = new Map()
  private pubkeyBuckets: Map<string, Bucket> = new Map()
  readonly maxConnections: number
  readonly maxConnectionsPerOperator: number

  constructor(opts: RateLimiterOptions = {}) {
    this.windowMs = opts.windowMs ?? 60_000
    this.perIpLimit = opts.perIpLimit ?? 100
    this.perPubkeyLimit = opts.perPubkeyLimit ?? 50
    this.maxConnections = opts.maxConnections ?? 1000
    this.maxConnectionsPerOperator = opts.maxConnectionsPerOperator ?? 10
  }

  /** Check if an IP is within rate limit. Returns true if allowed. */
  checkIp(ip: string): boolean {
    return this._check(this.ipBuckets, ip, this.perIpLimit)
  }

  /** Check if a pubkey is within rate limit. Returns true if allowed. */
  checkPubkey(pubkey: string): boolean {
    return this._check(this.pubkeyBuckets, pubkey, this.perPubkeyLimit)
  }

  private _check(
    buckets: Map<string, Bucket>,
    key: string,
    limit: number
  ): boolean {
    const now = Date.now()
    let bucket = buckets.get(key)

    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      bucket = { count: 0, windowStart: now }
    }

    if (bucket.count >= limit) {
      buckets.set(key, bucket)
      return false
    }

    bucket.count++
    buckets.set(key, bucket)
    return true
  }

  /** Clear all rate limit state (for testing). */
  reset(): void {
    this.ipBuckets.clear()
    this.pubkeyBuckets.clear()
  }
}

/** Extract the real client IP from request headers. */
export function getClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    '127.0.0.1'
  )
}
