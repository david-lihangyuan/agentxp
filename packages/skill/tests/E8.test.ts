// E8 Test Suite: Local Server + Auto-auth
// TDD: SSRF prevention, CSP headers, server lifecycle.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { startLocalServer, stopLocalServer, validateRelayUrl } from '../src/local-server.js'

describe('E8: Local Server + Auto-auth', () => {
  let testDir: string
  let testHome: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testDir = join(__dirname, '.tmp-e8-' + id)
    testHome = join(__dirname, '.tmp-home-e8-' + id)
    mkdirSync(testDir, { recursive: true })
    mkdirSync(testHome, { recursive: true })
  })

  afterEach(async () => {
    await stopLocalServer().catch(() => {})
    rmSync(testDir, { recursive: true, force: true })
    rmSync(testHome, { recursive: true, force: true })
  })

  it('Server starts and returns a valid port', async () => {
    const server = await startLocalServer({ workspaceDir: testDir, homeDir: testHome })
    expect(server.port).toBeGreaterThan(1024)
    expect(server.port).toBeLessThan(65535)
    await stopLocalServer()
  })

  it('Server responds with CSP headers', async () => {
    const server = await startLocalServer({ workspaceDir: testDir, homeDir: testHome })
    const res = await fetch(`http://127.0.0.1:${server.port}/health`)
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    await stopLocalServer()
  })

  it('Health endpoint returns ok', async () => {
    const server = await startLocalServer({ workspaceDir: testDir, homeDir: testHome })
    const res = await fetch(`http://127.0.0.1:${server.port}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    await stopLocalServer()
  })

  it('SSRF prevention — private IP rejected as relay URL', () => {
    const result = validateRelayUrl('wss://192.168.1.100')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('private')
  })

  it('SSRF prevention — 10.x range rejected', () => {
    const result = validateRelayUrl('wss://10.0.0.1:3141')
    expect(result.valid).toBe(false)
  })

  it('SSRF prevention — 172.16.x range rejected', () => {
    const result = validateRelayUrl('wss://172.16.0.1')
    expect(result.valid).toBe(false)
  })

  it('SSRF prevention — localhost rejected as relay URL', () => {
    const result = validateRelayUrl('wss://localhost:3141')
    expect(result.valid).toBe(false)
    const result2 = validateRelayUrl('wss://127.0.0.1:3141')
    expect(result2.valid).toBe(false)
  })

  it('SSRF prevention — ::1 IPv6 localhost rejected', () => {
    const result = validateRelayUrl('wss://[::1]:3141')
    expect(result.valid).toBe(false)
  })

  it('Valid relay URL accepted', () => {
    const result = validateRelayUrl('wss://relay.agentxp.io')
    expect(result.valid).toBe(true)
  })

  it('SSRF prevention — http:// rejected (only wss:// or https:// allowed)', () => {
    const result = validateRelayUrl('http://relay.agentxp.io')
    expect(result.valid).toBe(false)
  })

  it('SSRF prevention — https:// accepted', () => {
    const result = validateRelayUrl('https://relay.agentxp.io/api')
    expect(result.valid).toBe(true)
  })
})
