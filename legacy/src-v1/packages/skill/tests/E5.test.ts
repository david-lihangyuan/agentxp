// E5 Test Suite: Periodic Distillation
// TDD: distill() compacts reflection files into insights, archives raw entries,
// LLM trigger fires only when > 5 unparseable entries.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { distill, checkLLMTrigger } from '../src/distiller.js'
import { estimateTokens } from '../src/utils.js'

describe('E5: Periodic Distillation', () => {
  let testDir: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testDir = join(__dirname, '.tmp-e5-' + id)
    mkdirSync(join(testDir, 'reflection'), { recursive: true })
    mkdirSync(join(testDir, 'drafts'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  function seedReflectionFile(count: number): void {
    const entries: string[] = ['# Mistakes\n']
    for (let i = 0; i < count; i++) {
      entries.push(`## 2026-04-${String(i % 28 + 1).padStart(2, '0')} Docker DNS fix ${i}
- Tried: modified /etc/resolv.conf variant ${i} and restarted container
- Expected: DNS resolution would work immediately after config change
- Outcome: ${i % 3 === 0 ? 'failed' : 'succeeded'}
- Learned: docker container DNS cache ${i} cleared on restart, not on config reload, variant ${i} needed special handling
- Tags: docker, networking, dns
`)
    }
    writeFileSync(join(testDir, 'reflection', 'mistakes.md'), entries.join('\n'))
  }

  function seedUnparseable(count: number): void {
    const dir = join(testDir, 'drafts', 'unparseable')
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < count; i++) {
      writeFileSync(
        join(dir, `entry-${Date.now()}-${i}.md`),
        `Some freeform text that could not be parsed by rules. Entry number ${i}. It mentions some approach but lacks structure.`
      )
    }
  }

  it('Distillation compresses old entries into core insights', async () => {
    seedReflectionFile(20)
    const result = await distill(join(testDir, 'reflection'), testDir)
    expect(result.insights.length).toBeGreaterThan(0)
    // Insights should be meaningful strings
    for (const insight of result.insights) {
      expect(insight.length).toBeGreaterThan(10)
    }
  })

  it('Archive created for raw entries', async () => {
    seedReflectionFile(20)
    await distill(join(testDir, 'reflection'), testDir)
    const archiveDir = join(testDir, 'drafts', 'archive')
    expect(existsSync(archiveDir)).toBe(true)
    const files = readdirSync(archiveDir)
    expect(files.length).toBeGreaterThan(0)
  })

  it('Distillation returns archived count', async () => {
    seedReflectionFile(15)
    const result = await distill(join(testDir, 'reflection'), testDir)
    expect(result.archived).toBeGreaterThan(0)
  })

  it('LLM trigger does NOT fire when <= 5 unparseable entries', async () => {
    seedUnparseable(3)
    const triggered = await checkLLMTrigger(testDir)
    expect(triggered).toBe(false)
  })

  it('LLM trigger fires when > 5 unparseable entries', async () => {
    seedUnparseable(6)
    const triggered = await checkLLMTrigger(testDir)
    expect(triggered).toBe(true)
  })

  it('No fixed-schedule LLM call in distiller source', async () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'distiller.ts'), 'utf8')
    // Must not contain cron-like time patterns
    expect(source).not.toContain('0 14 * * *')
    expect(source).not.toContain('setInterval')
    expect(source).not.toContain('cron')
  })

  it('Distilled file is smaller than original', async () => {
    seedReflectionFile(20)
    const beforeSize = readFileSync(join(testDir, 'reflection', 'mistakes.md'), 'utf8').length
    await distill(join(testDir, 'reflection'), testDir)
    const afterSize = readFileSync(join(testDir, 'reflection', 'mistakes.md'), 'utf8').length
    expect(afterSize).toBeLessThan(beforeSize)
  })
})
