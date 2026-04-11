// B1 Test Suite: Project Scaffold
// TDD: Tests written first, implementation follows.
import { describe, it, expect, beforeAll } from 'bun:test'
import { Database } from 'bun:sqlite'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'
import { createLogger, captureLogOutput } from '../src/logger'

describe('B1: Health Endpoint', () => {
  it('GET /health returns 200 with status:ok and version', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; version: string }
    expect(body.status).toBe('ok')
    expect(body.version).toBeDefined()
    expect(body.version).toBe('0.1.0')
  })
})

describe('B1: Route versioning', () => {
  it('unversioned routes return 404', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const noVersion = await app.request('/api/experiences')
    expect(noVersion.status).toBe(404)
  })

  it('/api/v1/ prefix routes are accessible', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const versioned = await app.request('/api/v1/events', {
      method: 'GET',
    })
    // 405 or other non-404 means the route exists
    expect(versioned.status).not.toBe(404)
  })
})

describe('B1: Structured Logger', () => {
  it('emits JSON log lines with required fields', () => {
    const logs: string[] = []
    const logger = createLogger({ output: (line: string) => logs.push(line) })
    logger.info('test message', { method: 'GET', path: '/health', duration_ms: 5 })
    expect(logs.length).toBeGreaterThan(0)
    const parsed = JSON.parse(logs[0]) as Record<string, unknown>
    expect(parsed).toHaveProperty('timestamp')
    expect(parsed).toHaveProperty('level')
    expect(parsed.level).toBe('info')
    expect(parsed).toHaveProperty('method')
    expect(parsed).toHaveProperty('path')
    expect(parsed).toHaveProperty('duration_ms')
  })

  it('supports multiple log levels', () => {
    const logs: string[] = []
    const logger = createLogger({ output: (line: string) => logs.push(line) })
    logger.error('error msg', { method: 'POST', path: '/api/v1/events', duration_ms: 1 })
    const parsed = JSON.parse(logs[0]) as Record<string, unknown>
    expect(parsed.level).toBe('error')
  })
})

describe('B1: Migration Runner', () => {
  it('executes pending migrations on startup', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>
    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('events')
    expect(tableNames).toContain('identities')
    expect(tableNames).toContain('experiences')
    expect(tableNames).toContain('pulse_events')
    expect(tableNames).toContain('subscriptions')
    expect(tableNames).toContain('milestones')
    expect(tableNames).toContain('operator_notifications')
    expect(tableNames).toContain('experience_relations')
  })

  it('migrations are idempotent (running twice does not fail)', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    // Running again should not throw
    expect(() => runMigrations(db)).not.toThrow()
  })
})

describe('B1: Rate Limiter', () => {
  it('returns 429 after 100 requests from same IP within window', async () => {
    const app = createApp({ dbPath: ':memory:', rateLimitWindow: 1000, perIpLimit: 5 })
    // Use a distinct IP header
    const makeReq = () =>
      app.request('/health', { headers: { 'x-forwarded-for': '1.2.3.4' } })

    for (let i = 0; i < 5; i++) {
      const res = await makeReq()
      expect(res.status).toBe(200)
    }
    const throttled = await makeReq()
    expect(throttled.status).toBe(429)
  })

  it('different IPs have independent rate limit buckets', async () => {
    const app = createApp({ dbPath: ':memory:', rateLimitWindow: 1000, perIpLimit: 2 })
    // IP A: exhaust limit
    await app.request('/health', { headers: { 'x-forwarded-for': '10.0.0.1' } })
    await app.request('/health', { headers: { 'x-forwarded-for': '10.0.0.1' } })
    const throttledA = await app.request('/health', { headers: { 'x-forwarded-for': '10.0.0.1' } })
    expect(throttledA.status).toBe(429)

    // IP B: still works
    const okB = await app.request('/health', { headers: { 'x-forwarded-for': '10.0.0.2' } })
    expect(okB.status).toBe(200)
  })
})

describe('B1: Input Validation', () => {
  it('rejects tags with invalid characters', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/search?tags=<script>alert</script>', {
      method: 'GET',
    })
    expect(res.status).toBe(400)
  })

  it('accepts tags with valid characters', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/search?tags=docker-abc_1.0', {
      method: 'GET',
    })
    expect(res.status).not.toBe(400)
  })
})

describe('B1: Circuit Breaker', () => {
  it('returns 503 when embedding queue depth exceeds threshold', async () => {
    const app = createApp({
      dbPath: ':memory:',
      circuitBreakerThreshold: 2,
    })
    // Directly access circuit breaker state for testing
    const { getCircuitBreaker } = await import('../src/circuit-breaker')
    const cb = getCircuitBreaker(app)
    cb.setQueueDepth(3) // Over threshold

    const res = await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify({ kind: 'intent.broadcast' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(503)
  })
})
