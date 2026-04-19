// E4 Test Suite: Rule-Based Reflection Parser
// TDD: parseReflectionEntry extracts tried/outcome/learned/tags, quality gate filters bad entries.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseReflectionEntry, processReflectionFile } from '../src/reflection-parser.js'

describe('E4: Rule-Based Reflection Parser', () => {
  let testDir: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testDir = join(__dirname, '.tmp-e4-' + id)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('Parses structured entry correctly', () => {
    const entry = `## 2026-04-11 Missed import paths
- Tried: reorganized directory, updated paths in main repo
- Expected: tests would pass
- Outcome: failed
- Learned: cross-repo operations require listing all affected imports
- Tags: refactoring, imports`

    const parsed = parseReflectionEntry(entry)
    expect(parsed.tried).toContain('reorganized directory')
    expect(parsed.outcome).toBe('failed')
    expect(parsed.learned).toContain('cross-repo')
    expect(parsed.tags).toContain('refactoring')
  })

  it('Quality gate — too short → unparseable', () => {
    const short = `## 2026-04-11 learned to be careful
- Tried: did stuff
- Outcome: ok
- Learned: be careful`

    const result = parseReflectionEntry(short)
    expect(result.publishable).toBe(false)
    expect(result.reason).toContain('too short')
  })

  it('Quality gate — no specifics → unparseable', () => {
    const vague = `## 2026-04-11 general lesson
- Tried: some approach I tried yesterday that involved several steps
- Outcome: partial
- Learned: this approach sometimes works and sometimes doesn't depending on conditions`

    const result = parseReflectionEntry(vague)
    expect(result.publishable).toBe(false)
  })

  it('Quality gate — specific content passes', () => {
    const specific = `## 2026-04-11 Docker DNS fix
- Tried: modified /etc/resolv.conf and restarted container
- Outcome: succeeded
- Learned: docker container DNS cache cleared on restart, not on config reload
- Tags: docker, networking, dns`

    const result = parseReflectionEntry(specific)
    expect(result.publishable).toBe(true)
  })

  it('Unparseable entries routed to drafts/unparseable/', async () => {
    const reflectionDir = join(testDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })

    // Write a file with one bad entry
    writeFileSync(join(reflectionDir, 'mistakes.md'), `# Mistakes

## 2026-04-11 too vague
- Tried: did stuff
- Outcome: ok
- Learned: be careful
`)

    await processReflectionFile(join(reflectionDir, 'mistakes.md'), testDir)
    expect(existsSync(join(testDir, 'drafts', 'unparseable'))).toBe(true)
    const files = readdirSync(join(testDir, 'drafts', 'unparseable'))
    expect(files.length).toBeGreaterThan(0)
  })
})
