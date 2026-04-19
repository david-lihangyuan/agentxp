// E2b Test Suite: Identity Initialization + CLI Shim
// TDD: Keys generated to ~/.agentxp/identity/, idempotent, CLI status works.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { runInstall } from '../src/install.js'
import { getStatus } from '../src/cli.js'

describe('E2b: Identity Initialization + CLI Shim', () => {
  let testDir: string
  let testHome: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testDir = join(__dirname, '.tmp-e2b-' + id)
    testHome = join(__dirname, '.tmp-home-e2b-' + id)
    mkdirSync(testDir, { recursive: true })
    mkdirSync(testHome, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    rmSync(testHome, { recursive: true, force: true })
  })

  it('Keys generated to ~/.agentxp/identity/ on first install', async () => {
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    expect(existsSync(join(testHome, '.agentxp/identity/operator.key'))).toBe(true)
    expect(existsSync(join(testHome, '.agentxp/identity/operator.pub'))).toBe(true)
  })

  it('Keys are NOT generated on second install (idempotent)', async () => {
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    const firstKey = readFileSync(join(testHome, '.agentxp/identity/operator.pub'), 'utf8')
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    const secondKey = readFileSync(join(testHome, '.agentxp/identity/operator.pub'), 'utf8')
    expect(firstKey).toBe(secondKey)
  })

  it('Generated keys are valid Ed25519 hex (64 char pubkey)', async () => {
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    const pubKey = readFileSync(join(testHome, '.agentxp/identity/operator.pub'), 'utf8').trim()
    expect(pubKey).toMatch(/^[0-9a-f]{64}$/)
    const privKey = readFileSync(join(testHome, '.agentxp/identity/operator.key'), 'utf8').trim()
    expect(privKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('agentxp status command works after install', async () => {
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    const status = getStatus(testDir, testHome)
    expect(status.agent_name).toBeDefined()
    expect(status.agent_name).not.toBe('unknown')
    expect(status.relay_connected).toBeDefined()
    expect(status.identity_exists).toBe(true)
    expect(status.reflection_dir_exists).toBe(true)
  })
})
