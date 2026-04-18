// E1 Test Suite: SKILL.md + Proactive Recall
// TDD: SKILL.md under 500 tokens, proactive recall matches task descriptions against local reflection files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { proactiveRecall } from '../src/proactive-recall.js'
import { estimateTokens } from '../src/utils.js'

const SKILL_PATH = join(__dirname, '..', 'SKILL.md')
const GUIDE_PATH = join(__dirname, '..', 'SKILL-GUIDE.md')

describe('E1: SKILL.md + Proactive Recall', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(__dirname, '.tmp-e1-' + Date.now())
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('SKILL.md is under 500 tokens', () => {
    const content = readFileSync(SKILL_PATH, 'utf8')
    const tokens = estimateTokens(content)
    expect(tokens).toBeLessThan(500)
  })

  it('SKILL.md contains reflection trigger instructions', () => {
    const content = readFileSync(SKILL_PATH, 'utf8')
    expect(content).toContain('mistakes.md')
    expect(content).toContain('lessons.md')
    expect(content).toContain('why did I think I was right')
  })

  it('SKILL.md contains external_experience delimiter instruction', () => {
    const content = readFileSync(SKILL_PATH, 'utf8')
    expect(content).toContain('<external_experience>')
  })

  it('Proactive recall matches task description against local index', async () => {
    // Set up test reflection files
    const reflectionDir = join(testDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })

    writeFileSync(join(reflectionDir, 'mistakes.md'), `# Mistakes

## 2026-04-11 Missed import paths after directory restructure
- Tried: Reorganized directory structure, updated import paths in main repo
- Expected: Tests would pass after updating main repo imports
- Outcome: failed
- Learned: Cross-repo operations require listing ALL affected imports
- Tags: refactoring, imports
`)

    writeFileSync(join(reflectionDir, 'lessons.md'), `# Lessons

## 2026-04-10 Docker restart clears DNS cache
- Tried: Modified /etc/resolv.conf and restarted container
- Outcome: succeeded
- Learned: docker container DNS cache cleared on restart
- Tags: docker, networking
`)

    const matches = await proactiveRecall('directory restructure cross-repo', reflectionDir)
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].file).toBe('mistakes.md')
    expect(matches[0].content).toContain('import paths')
  })

  it('Proactive recall returns empty for unrelated task', async () => {
    const reflectionDir = join(testDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })

    writeFileSync(join(reflectionDir, 'mistakes.md'), `# Mistakes

## 2026-04-11 Missed import paths after directory restructure
- Tried: Reorganized directory, updated paths
- Outcome: failed
- Learned: Cross-repo operations require listing ALL affected imports
- Tags: refactoring, imports
`)
    writeFileSync(join(reflectionDir, 'lessons.md'), '# Lessons\n')

    const noMatches = await proactiveRecall('write a poem about the sea', reflectionDir)
    expect(noMatches.length).toBe(0)
  })

  it('SKILL-GUIDE.md exists separately (for humans, not loaded into context)', () => {
    expect(existsSync(GUIDE_PATH)).toBe(true)
    const guide = readFileSync(GUIDE_PATH, 'utf8')
    expect(estimateTokens(guide)).toBeGreaterThan(500) // guide can be long
  })
})
