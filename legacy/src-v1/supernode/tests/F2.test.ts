// F2 Test Suite: Dashboard Web UI
// TDD: HTML served, CSP headers, no innerHTML, growth view sections, verifier/failure display.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'

describe('F2: Dashboard Web UI', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    const db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  // Test 1: Dashboard HTML served at /dashboard
  it('GET /dashboard returns 200 HTML', async () => {
    const res = await app.request('/dashboard')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  // Test 2: CSP header is present and correct
  it('CSP header includes script-src self and no unsafe-inline', async () => {
    const res = await app.request('/dashboard')
    const csp = res.headers.get('content-security-policy')
    expect(csp).toBeTruthy()
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("'unsafe-inline'")
  })

  // Test 3: No innerHTML usage in HTML/JS served
  it('dashboard HTML has no innerHTML assignments', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    expect(html).not.toContain('.innerHTML =')
    expect(html).not.toContain('.innerHTML=')
  })

  // Test 4: Growth view section exists
  it('dashboard HTML contains growth view sections', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    expect(html.toLowerCase()).toContain('growth')
    expect(html.toLowerCase()).toContain('milestone')
  })

  // Test 5: Verifier diversity display format
  it('dashboard HTML contains verifier diversity display strings', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    expect(html.toLowerCase()).toContain('operator')
    expect(html.toLowerCase()).toContain('domain')
  })

  // Test 6: Failure impact display exists
  it('dashboard HTML contains failure impact section', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    expect(html.toLowerCase()).toContain('failure')
  })

  // Test 7: Operator-specific page exists
  it('GET /dashboard/operator returns 200 HTML', async () => {
    const res = await app.request('/dashboard/operator')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  // Test 8: Operator page also has no innerHTML
  it('operator page HTML has no innerHTML assignments', async () => {
    const res = await app.request('/dashboard/operator')
    const html = await res.text()
    expect(html).not.toContain('.innerHTML =')
    expect(html).not.toContain('.innerHTML=')
  })

  // Test 9: Operator page also has CSP
  it('operator page has CSP header', async () => {
    const res = await app.request('/dashboard/operator')
    const csp = res.headers.get('content-security-policy')
    expect(csp).toBeTruthy()
    expect(csp).toContain("script-src 'self'")
  })

  // Test 10: Network overview section present
  it('dashboard HTML contains network overview section', async () => {
    const res = await app.request('/dashboard')
    const html = await res.text()
    expect(html.toLowerCase()).toContain('network')
  })
})
