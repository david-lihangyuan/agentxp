// E2 Test Suite: Install Script + Directory Setup
// TDD: One command creates reflection dirs, appends AGENTS.md, adds .gitignore, creates config.yaml.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { runInstall } from '../src/install.js'

describe('E2: Install Script + Directory Setup', () => {
  let testDir: string
  let testHome: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testDir = join(__dirname, '.tmp-e2-' + id)
    testHome = join(__dirname, '.tmp-home-e2-' + id)
    mkdirSync(testDir, { recursive: true })
    mkdirSync(testHome, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    rmSync(testHome, { recursive: true, force: true })
  })

  it('Creates reflection directory structure', async () => {
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    expect(existsSync(join(testDir, 'reflection/mistakes.md'))).toBe(true)
    expect(existsSync(join(testDir, 'reflection/lessons.md'))).toBe(true)
    expect(existsSync(join(testDir, 'reflection/feelings.md'))).toBe(true)
    expect(existsSync(join(testDir, 'reflection/thoughts.md'))).toBe(true)
    expect(existsSync(join(testDir, 'drafts'))).toBe(true)
    expect(existsSync(join(testDir, 'published'))).toBe(true)
  })

  it('Appends to AGENTS.md without breaking existing content', async () => {
    const original = '# My Agent\n\nExisting content here.'
    writeFileSync(join(testDir, 'AGENTS.md'), original)
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    const after = readFileSync(join(testDir, 'AGENTS.md'), 'utf8')
    expect(after).toContain('Existing content here.')
    expect(after).toContain('AgentXP Skill')
  })

  it('Idempotent — running twice does not duplicate AGENTS.md block', async () => {
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    const count = (readFileSync(join(testDir, 'AGENTS.md'), 'utf8').match(/AgentXP Skill/g) || []).length
    expect(count).toBe(1)
  })

  it('reflection/ added to .gitignore automatically', async () => {
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    const gitignore = readFileSync(join(testDir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('reflection/')
  })

  it('config.yaml has only 3 human-readable fields', async () => {
    await runInstall({ workspaceDir: testDir, homeDir: testHome, skipCliSymlink: true })
    const config = readFileSync(join(testDir, 'skills/agentxp/config.yaml'), 'utf8')
    expect(config).toContain('agent_name')
    expect(config).toContain('relay_url')
    expect(config).toContain('visibility_default')
    expect(config).not.toContain('privateKey')
    expect(config).not.toContain('publicKey')
  })
})
