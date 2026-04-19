// Supernode — Circuit Breaker for Embedding Queue
// Opens (503) when queue depth > CIRCUIT_BREAKER_THRESHOLD.
// Auto-recovers when queue drains below 50% of threshold.

export interface CircuitBreakerOptions {
  /** Queue depth at which circuit opens. Default: 10000 */
  threshold?: number
  /** Queue depth ratio at which circuit auto-recovers. Default: 0.5 */
  recoveryRatio?: number
}

export type CircuitState = 'closed' | 'open'

export class CircuitBreaker {
  private threshold: number
  private recoveryRatio: number
  private _queueDepth: number = 0
  private _state: CircuitState = 'closed'

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = opts.threshold ?? 10_000
    this.recoveryRatio = opts.recoveryRatio ?? 0.5
  }

  get state(): CircuitState {
    return this._state
  }

  get queueDepth(): number {
    return this._queueDepth
  }

  /** Update queue depth and transition state accordingly. */
  setQueueDepth(depth: number): void {
    this._queueDepth = depth
    if (depth > this.threshold) {
      this._state = 'open'
    } else if (depth <= this.threshold * this.recoveryRatio) {
      this._state = 'closed'
    }
    // Between recovery ratio and threshold: stay in current state
  }

  /** Increment queue depth by 1. */
  enqueue(): void {
    this.setQueueDepth(this._queueDepth + 1)
  }

  /** Decrement queue depth by 1. */
  dequeue(): void {
    this.setQueueDepth(Math.max(0, this._queueDepth - 1))
  }

  /** Returns true if circuit is open (should return 503). */
  isOpen(): boolean {
    return this._state === 'open'
  }

  /** Reset to initial state (for testing). */
  reset(): void {
    this._queueDepth = 0
    this._state = 'closed'
  }
}

// App-level circuit breaker instance registry
// Keyed by app symbol to support test isolation
const _breakers: WeakMap<object, CircuitBreaker> = new WeakMap()

export function getCircuitBreaker(app: object): CircuitBreaker {
  let cb = _breakers.get(app)
  if (!cb) {
    cb = new CircuitBreaker()
    _breakers.set(app, cb)
  }
  return cb
}

export function setCircuitBreaker(app: object, cb: CircuitBreaker): void {
  _breakers.set(app, cb)
}
