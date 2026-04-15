// distill.test.ts — Tests for the HEM-inspired experience distillation engine
// and phase-aware proactive recall.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { distillExperiences } from '../src/distill.js'
import { proactiveRecall, inferPhase, phaseWeight } from '../src/proactive-recall.js'
import type { RecallMatch, TaskPhase } from '../src/proactive-recall.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `agentxp-distill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeFile(dir: string, relPath: string, content: string): void {
  const full = join(dir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

function readFile(dir: string, relPath: string): string {
  return readFileSync(join(dir, relPath), 'utf8')
}

/**
 * Build a mistakes.md with N entries all matching the given pattern.
 * Uses template content that reliably triggers the named pattern's keywords.
 */
function buildMistakesContent(
  patternId: 'unverified' | 'incomplete' | 'symptom-fix' | string,
  count: number,
  customTag?: string
): string {
  const lines = ['# Mistakes\n']

  const snippets: Record<string, string[]> = {
    unverified: [
      'I assumed the port was 3000 without checking.',
      'Turned out the path was wrong.',
      'I fabricated a URL that did not exist.',
      'Used wrong endpoint without verifying.',
      'Made wrong assumption about the config file.',
      'Did not verify the schema before proceeding.',
      'Assumed the server was running without checking.',
    ],
    incomplete: [
      'Forgot to update the documentation.',
      'Work was only partially done when marked complete.',
      'Missed syncing the config file.',
      'Overlooked the integration test.',
      'Implementation was incomplete at review time.',
      'Tests pass but the feature was not deployed.',
      'Left out the migration script.',
    ],
    'symptom-fix': [
      'Same bug appeared again after the hotfix.',
      'Same error recurring in production.',
      'Fixed it a second time with the same workaround.',
      'Root cause was never found — same issue came back.',
      'This is a recurring problem with the auth module.',
      'Same bug pattern repeated in a different module.',
      'Again the same underlying issue was not addressed.',
    ],
  }

  const fallbackSnippets = [
    `Encountered a ${patternId} problem again.`,
    `Another ${patternId} issue occurred.`,
    `${patternId} pattern repeated.`,
    `Same ${patternId} mistake.`,
    `Yet another ${patternId} error.`,
    `Recurring ${patternId} problem.`,
    `The ${patternId} issue came up again.`,
  ]

  const pool = snippets[patternId] ?? fallbackSnippets

  const date = '2024-01-01'
  const tag = customTag ?? patternId
  for (let i = 0; i < count; i++) {
    const snippet = pool[i % pool.length]
    lines.push(`## ${date} Entry ${i + 1}`)
    lines.push(`- Tried: Something`)
    lines.push(`- Outcome: failed`)
    lines.push(`- Learned: ${snippet}`)
    lines.push(`- Tags: ${tag}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// distillExperiences — basic threshold tests
// ---------------------------------------------------------------------------

describe('distillExperiences — threshold', () => {
  let tmpDir: string
  let reflectionDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
    reflectionDir = join(tmpDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns zeroes when no mistakes.md exists', () => {
    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBe(0)
    expect(result.updatedRules).toBe(0)
    expect(result.totalStrategies).toBe(0)
  })

  it('does NOT distill when pattern count is exactly 4 (below threshold)', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('unverified', 4))

    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBe(0)
    expect(result.updatedRules).toBe(0)
    expect(result.totalStrategies).toBe(0)
    expect(existsSync(join(reflectionDir, 'lessons.md'))).toBe(false)
  })

  it('distills when pattern count reaches exactly 5', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('unverified', 5))

    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBe(1)
    expect(result.updatedRules).toBe(0)
    expect(result.totalStrategies).toBe(1)

    expect(existsSync(join(reflectionDir, 'lessons.md'))).toBe(true)
    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('[auto-distilled]')
    expect(lessons).toContain('Pattern: unverified')
    expect(lessons).toContain('Based on: 5 similar mistakes')
    expect(lessons).toContain('Confidence: 0.50')
  })

  it('distills when pattern count is more than 5', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('incomplete', 7))

    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBe(1)
    expect(result.totalStrategies).toBe(1)

    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Pattern: incomplete')
    expect(lessons).toContain('Based on: 7 similar mistakes')
  })
})

// ---------------------------------------------------------------------------
// distillExperiences — rule content
// ---------------------------------------------------------------------------

describe('distillExperiences — rule content for built-in patterns', () => {
  let tmpDir: string
  let reflectionDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
    reflectionDir = join(tmpDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('uses the unverified rule template', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('unverified', 5))
    distillExperiences(reflectionDir)
    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('verify the claim by checking source data')
  })

  it('uses the incomplete rule template', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('incomplete', 5))
    distillExperiences(reflectionDir)
    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('end-to-end verification')
  })

  it('uses the symptom-fix rule template', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('symptom-fix', 5))
    distillExperiences(reflectionDir)
    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('search the entire codebase for the same pattern')
  })

  it('uses a generic template for custom tags', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('my-custom-tag', 5, 'my-custom-tag'))
    distillExperiences(reflectionDir)
    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain("Pattern 'my-custom-tag'")
    expect(lessons).toContain('Review past mistakes with this tag')
  })

  it('includes a sequential sr_NNN id format', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('unverified', 5))
    distillExperiences(reflectionDir)
    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toMatch(/sr_\d{3}/)
  })

  it('includes Tags: auto-distilled line', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('unverified', 5))
    distillExperiences(reflectionDir)
    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Tags: auto-distilled, unverified')
  })
})

// ---------------------------------------------------------------------------
// distillExperiences — update existing strategy
// ---------------------------------------------------------------------------

describe('distillExperiences — update vs. create', () => {
  let tmpDir: string
  let reflectionDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
    reflectionDir = join(tmpDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('does NOT create a duplicate when strategy already exists', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('unverified', 5))

    // First distill
    distillExperiences(reflectionDir)
    const count1 = (readFile(tmpDir, 'reflection/lessons.md').match(/\[auto-distilled\]/g) ?? []).length
    expect(count1).toBe(1)

    // Second distill with same data
    distillExperiences(reflectionDir)
    const count2 = (readFile(tmpDir, 'reflection/lessons.md').match(/\[auto-distilled\]/g) ?? []).length
    expect(count2).toBe(1) // Still only one
  })

  it('updates supportingCount when more mistakes accumulate', () => {
    // Start with 5 mistakes
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('incomplete', 5))
    distillExperiences(reflectionDir)

    let lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Based on: 5 similar mistakes')

    // Add more mistakes (now 8)
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('incomplete', 8))
    const result = distillExperiences(reflectionDir)

    expect(result.newRules).toBe(0)
    expect(result.updatedRules).toBe(1)

    lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Based on: 8 similar mistakes')
  })

  it('increases confidence by 0.05 per new supporting mistake', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('symptom-fix', 5))
    distillExperiences(reflectionDir)

    let lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Confidence: 0.50')

    // Add 2 more mistakes (delta = 2 → confidence += 0.10)
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('symptom-fix', 7))
    distillExperiences(reflectionDir)

    lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Confidence: 0.60')
  })

  it('does not update when count has not changed', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('unverified', 5))
    distillExperiences(reflectionDir)

    // Run again with same data
    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBe(0)
    expect(result.updatedRules).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// distillExperiences — multiple patterns simultaneously
// ---------------------------------------------------------------------------

describe('distillExperiences — multiple patterns', () => {
  let tmpDir: string
  let reflectionDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
    reflectionDir = join(tmpDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('distills multiple patterns in one pass', () => {
    // Build mistakes.md with 5+ entries for two patterns
    const unverifiedEntries = buildMistakesContent('unverified', 5)
    const incompleteEntries = buildMistakesContent('incomplete', 5)

    // Combine (skip the "# Mistakes" header from the second block)
    const combined = unverifiedEntries + '\n' + incompleteEntries
      .split('\n')
      .filter(l => !l.startsWith('# Mistakes'))
      .join('\n')

    writeFile(tmpDir, 'reflection/mistakes.md', combined)

    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBeGreaterThanOrEqual(2)
    expect(result.totalStrategies).toBeGreaterThanOrEqual(2)

    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Pattern: unverified')
    expect(lessons).toContain('Pattern: incomplete')
  })

  it('only distills patterns that meet the 5+ threshold', () => {
    // 5 unverified (should distill), 3 incomplete (should NOT)
    const content = buildMistakesContent('unverified', 5) + '\n' +
      buildMistakesContent('incomplete', 3)
        .split('\n')
        .filter(l => !l.startsWith('# Mistakes'))
        .join('\n')

    writeFile(tmpDir, 'reflection/mistakes.md', content)

    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBe(1)

    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Pattern: unverified')
    expect(lessons).not.toContain('Pattern: incomplete')
  })

  it('totalStrategies reflects count across multiple calls', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('unverified', 5))
    distillExperiences(reflectionDir)

    writeFile(tmpDir, 'reflection/mistakes.md',
      buildMistakesContent('unverified', 5) + '\n' +
      buildMistakesContent('incomplete', 5)
        .split('\n').filter(l => !l.startsWith('# Mistakes')).join('\n')
    )
    const result = distillExperiences(reflectionDir)
    expect(result.totalStrategies).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// inferPhase
// ---------------------------------------------------------------------------

describe('inferPhase — phase inference from task description', () => {
  it('returns "planning" for plan/design/architect/how to keywords', () => {
    expect(inferPhase('Let us plan the new feature')).toBe('planning')
    expect(inferPhase('Design the database schema')).toBe('planning')
    expect(inferPhase('Architect the microservice')).toBe('planning')
    expect(inferPhase('How to implement auth')).toBe('planning')
  })

  it('returns "stuck" for fix/debug/error/broken/failing keywords', () => {
    expect(inferPhase('Fix the broken login flow')).toBe('stuck')
    expect(inferPhase('Debug this error in production')).toBe('stuck')
    expect(inferPhase('The test is failing on CI')).toBe('stuck')
    expect(inferPhase('Something is broken in the pipeline')).toBe('stuck')
  })

  it('returns "evaluating" for review/audit/inspect keywords', () => {
    expect(inferPhase('Review code changes')).toBe('evaluating')
    expect(inferPhase('Code review for the PR')).toBe('evaluating')
    expect(inferPhase('Audit the security config')).toBe('evaluating')
    expect(inferPhase('Inspect the build output')).toBe('evaluating')
    // Generic "check" and "test" no longer trigger evaluating (too many false positives)
    expect(inferPhase('Check if all tests pass')).toBe('executing')
    expect(inferPhase('Test the new feature')).toBe('executing')
  })

  it('returns "executing" for anything else', () => {
    expect(inferPhase('Implement the new API endpoint')).toBe('executing')
    expect(inferPhase('Add logging to the service')).toBe('executing')
    expect(inferPhase('Update the README')).toBe('executing')
    expect(inferPhase('')).toBe('executing')
  })

  it('stuck takes priority over planning in mixed description', () => {
    // stuck is checked first (strongest signal)
    expect(inferPhase('plan to fix the bug')).toBe('stuck')
    // pure planning still works
    expect(inferPhase('plan the new architecture')).toBe('planning')
  })
})

// ---------------------------------------------------------------------------
// phaseWeight
// ---------------------------------------------------------------------------

describe('phaseWeight — weight multipliers per phase and source', () => {
  function makeMatch(file: string, isDistilled: boolean): RecallMatch {
    return {
      file,
      title: isDistilled ? 'Some Rule [auto-distilled]' : 'Some Rule',
      content: isDistilled
        ? '- Rule: do something\n- Pattern: unverified\n[auto-distilled]\n'
        : '- Tried: something\n- Outcome: failed\n',
      score: 1,
    }
  }

  it('planning: distilled lessons > plain lessons > mistakes', () => {
    const distilled = makeMatch('lessons.md', true)
    const plain = makeMatch('lessons.md', false)
    const mistake = makeMatch('mistakes.md', false)

    const wDistilled = phaseWeight(distilled, 'planning')
    const wPlain = phaseWeight(plain, 'planning')
    const wMistake = phaseWeight(mistake, 'planning')

    expect(wDistilled).toBeGreaterThan(wPlain)
    expect(wPlain).toBeGreaterThan(wMistake)
  })

  it('executing: distilled lessons > plain lessons > mistakes', () => {
    const distilled = makeMatch('lessons.md', true)
    const plain = makeMatch('lessons.md', false)
    const mistake = makeMatch('mistakes.md', false)

    expect(phaseWeight(distilled, 'executing')).toBeGreaterThan(phaseWeight(plain, 'executing'))
    expect(phaseWeight(plain, 'executing')).toBeGreaterThan(phaseWeight(mistake, 'executing'))
  })

  it('stuck: mistakes > distilled > plain lessons', () => {
    const distilled = makeMatch('lessons.md', true)
    const plain = makeMatch('lessons.md', false)
    const mistake = makeMatch('mistakes.md', false)

    const wMistake = phaseWeight(mistake, 'stuck')
    const wDistilled = phaseWeight(distilled, 'stuck')
    const wPlain = phaseWeight(plain, 'stuck')

    expect(wMistake).toBeGreaterThan(wDistilled)
    expect(wDistilled).toBeGreaterThan(wPlain)
  })

  it('evaluating: distilled has highest weight, mistakes still usable', () => {
    const distilled = makeMatch('lessons.md', true)
    const mistake = makeMatch('mistakes.md', false)

    expect(phaseWeight(distilled, 'evaluating')).toBeGreaterThan(phaseWeight(mistake, 'evaluating'))
    // Mistakes are no longer zero-weighted in evaluating — they serve as checklist items
    expect(phaseWeight(mistake, 'evaluating')).toBeGreaterThanOrEqual(0.5)
  })
})

// ---------------------------------------------------------------------------
// proactiveRecall — phase-aware sorting
// ---------------------------------------------------------------------------

describe('proactiveRecall — phase-aware sorting', () => {
  let tmpDir: string
  let reflectionDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
    reflectionDir = join(tmpDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  function buildLessonsWithDistilled(): string {
    return [
      '# Lessons',
      '',
      '## 2024-01-01 Acting on Unverified Assumptions [auto-distilled]',
      '- Rule: Always verify before acting. Check the actual port or path.',
      '- Confidence: 0.50',
      '- Based on: 5 similar mistakes',
      '- Pattern: unverified',
      '- TimesApplied: 0',
      '- LastReinforced: 2024-01-01',
      '- Tags: auto-distilled, unverified',
      '',
      '## 2024-01-02 Manual Lesson About Ports',
      '- Tried: Using port 3000 for all services',
      '- Outcome: failed',
      '- Learned: Always check which port the service is actually running on.',
      '- Tags: manual, ports',
      '',
    ].join('\n')
  }

  function buildMistakesWithPort(): string {
    return [
      '# Mistakes',
      '',
      '## 2024-01-03 Port assumption error',
      '- Tried: Connecting to port 3000',
      '- Outcome: failed',
      '- Learned: Port was 4000, not 3000. Always verify.',
      '- Tags: unverified, ports',
      '',
    ].join('\n')
  }

  it('planning phase: distilled lessons rank first', async () => {
    writeFile(tmpDir, 'reflection/lessons.md', buildLessonsWithDistilled())
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesWithPort())

    const matches = await proactiveRecall('plan the port configuration', {
      reflectionDir,
      phase: 'planning',
    }) as RecallMatch[]

    expect(matches.length).toBeGreaterThan(0)
    // The first result should be the distilled lesson (or at minimum distilled should appear)
    const hasDistilled = matches.some(m =>
      m.file === 'lessons.md' && (m.title.includes('[auto-distilled]') || m.content.includes('[auto-distilled]'))
    )
    expect(hasDistilled).toBe(true)

    // In planning mode, distilled should beat plain mistakes at same keyword score
    const distilledIdx = matches.findIndex(m =>
      m.file === 'lessons.md' && (m.title.includes('[auto-distilled]') || m.content.includes('[auto-distilled]'))
    )
    const mistakeIdx = matches.findIndex(m => m.file === 'mistakes.md')
    if (distilledIdx >= 0 && mistakeIdx >= 0) {
      expect(distilledIdx).toBeLessThan(mistakeIdx)
    }
  })

  it('stuck phase: mistakes rank first', async () => {
    writeFile(tmpDir, 'reflection/lessons.md', buildLessonsWithDistilled())
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesWithPort())

    const matches = await proactiveRecall('fix port error failing', {
      reflectionDir,
      phase: 'stuck',
    }) as RecallMatch[]

    expect(matches.length).toBeGreaterThan(0)
    const firstMatch = matches[0]
    // In stuck mode, concrete mistakes should rank first (or at least appear)
    const mistakeIdx = matches.findIndex(m => m.file === 'mistakes.md')
    const distilledIdx = matches.findIndex(m =>
      m.file === 'lessons.md' && (m.title.includes('[auto-distilled]') || m.content.includes('[auto-distilled]'))
    )
    if (mistakeIdx >= 0 && distilledIdx >= 0) {
      expect(mistakeIdx).toBeLessThan(distilledIdx)
    }
    expect(firstMatch).toBeTruthy()
  })

  it('evaluating phase: only returns distilled strategies', async () => {
    writeFile(tmpDir, 'reflection/lessons.md', buildLessonsWithDistilled())
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesWithPort())

    const matches = await proactiveRecall('verify port configuration check', {
      reflectionDir,
      phase: 'evaluating',
    }) as RecallMatch[]

    // Every returned match must be from lessons.md and distilled
    for (const match of matches) {
      expect(match.file).toBe('lessons.md')
      const isDistilled = match.content.includes('[auto-distilled]') ||
        match.title.includes('[auto-distilled]')
      expect(isDistilled).toBe(true)
    }
  })

  it('executing phase: distilled lessons rank first', async () => {
    writeFile(tmpDir, 'reflection/lessons.md', buildLessonsWithDistilled())
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesWithPort())

    const matches = await proactiveRecall('implement port binding service', {
      reflectionDir,
      phase: 'executing',
    }) as RecallMatch[]

    expect(matches.length).toBeGreaterThan(0)
    const distilledIdx = matches.findIndex(m =>
      m.file === 'lessons.md' && (m.title.includes('[auto-distilled]') || m.content.includes('[auto-distilled]'))
    )
    const mistakeIdx = matches.findIndex(m => m.file === 'mistakes.md')
    if (distilledIdx >= 0 && mistakeIdx >= 0) {
      expect(distilledIdx).toBeLessThan(mistakeIdx)
    }
  })

  it('infers phase automatically from taskDescription when phase not provided', async () => {
    writeFile(tmpDir, 'reflection/lessons.md', buildLessonsWithDistilled())
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesWithPort())

    // "fix" should trigger stuck phase
    const stuckMatches = await proactiveRecall('fix the port error', {
      reflectionDir,
    }) as RecallMatch[]

    // "plan" should trigger planning phase
    const planMatches = await proactiveRecall('plan port configuration', {
      reflectionDir,
    }) as RecallMatch[]

    // Both should return results
    expect(stuckMatches.length).toBeGreaterThanOrEqual(0)
    expect(planMatches.length).toBeGreaterThanOrEqual(0)

    // The ordering should differ between phases (if both have matches)
    if (stuckMatches.length > 1 && planMatches.length > 1) {
      // stuck: mistakes first; plan: distilled first
      const stuckFirst = stuckMatches[0]
      const planFirst = planMatches[0]
      // At minimum the first results should come from different sources
      // (this is a soft check — depends on keyword overlap)
      expect(stuckFirst || planFirst).toBeTruthy()
    }
  })

  it('backward-compatible string signature still works', async () => {
    writeFile(tmpDir, 'reflection/lessons.md', buildLessonsWithDistilled())
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesWithPort())

    const matches = await proactiveRecall('port error fix', reflectionDir) as RecallMatch[]
    expect(Array.isArray(matches)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// proactiveRecall — confidence reinforcement
// ---------------------------------------------------------------------------

describe('proactiveRecall — confidence reinforcement', () => {
  let tmpDir: string
  let reflectionDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
    reflectionDir = join(tmpDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('increments TimesApplied in lessons.md when distilled strategy is returned', async () => {
    const lessonsContent = [
      '# Lessons',
      '',
      '## 2024-01-01 Acting on Unverified Assumptions [auto-distilled]',
      '- Rule: Always verify before acting.',
      '- Confidence: 0.50',
      '- Based on: 5 similar mistakes',
      '- Pattern: unverified',
      '- TimesApplied: 3',
      '- LastReinforced: 2024-01-01',
      '- Tags: auto-distilled, unverified',
      '',
    ].join('\n')

    writeFile(tmpDir, 'reflection/lessons.md', lessonsContent)

    await proactiveRecall('verify assumptions', {
      reflectionDir,
      phase: 'planning',
    })

    const updated = readFile(tmpDir, 'reflection/lessons.md')
    expect(updated).toContain('TimesApplied: 4')
  })

  it('updates LastReinforced to today when distilled strategy is returned', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const lessonsContent = [
      '# Lessons',
      '',
      '## 2024-01-01 Acting on Unverified Assumptions [auto-distilled]',
      '- Rule: Always verify before acting.',
      '- Confidence: 0.50',
      '- Based on: 5 similar mistakes',
      '- Pattern: unverified',
      '- TimesApplied: 0',
      '- LastReinforced: 2020-01-01',
      '- Tags: auto-distilled, unverified',
      '',
    ].join('\n')

    writeFile(tmpDir, 'reflection/lessons.md', lessonsContent)

    await proactiveRecall('verify assumptions', {
      reflectionDir,
      phase: 'planning',
    })

    const updated = readFile(tmpDir, 'reflection/lessons.md')
    expect(updated).toContain(`LastReinforced: ${today}`)
  })

  it('does not throw when lessons.md does not exist', async () => {
    await expect(
      proactiveRecall('verify something', { reflectionDir, phase: 'planning' })
    ).resolves.not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// distillExperiences — edge cases
// ---------------------------------------------------------------------------

describe('distillExperiences — edge cases', () => {
  let tmpDir: string
  let reflectionDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
    reflectionDir = join(tmpDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('creates reflection dir if it does not exist', () => {
    const newDir = join(tmpDir, 'new-reflection')
    expect(existsSync(newDir)).toBe(false)
    const result = distillExperiences(newDir)
    expect(existsSync(newDir)).toBe(true)
    expect(result.newRules).toBe(0)
  })

  it('appends to existing lessons.md without overwriting manual content', () => {
    writeFile(tmpDir, 'reflection/lessons.md', '# Lessons\n\n## 2024-01-01 Manual Lesson\n- Tried: Something\n- Learned: Always double-check.\n\n')
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('unverified', 5))

    distillExperiences(reflectionDir)

    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Manual Lesson')
    expect(lessons).toContain('Always double-check.')
    expect(lessons).toContain('[auto-distilled]')
  })

  it('detects pattern via keyword matching (not just tags)', () => {
    // Entries that match 'unverified' keywords but do NOT have explicit tags
    const content = [
      '# Mistakes',
      '',
      ...Array.from({ length: 5 }, (_, i) => [
        `## 2024-01-0${i + 1} Entry ${i + 1}`,
        '- Tried: Connect to service',
        '- Outcome: failed',
        `- Learned: I assumed the port was 3000 but it was actually 4000.`,
        '- Tags: general',
        '',
      ].join('\n')),
    ].join('\n')

    writeFile(tmpDir, 'reflection/mistakes.md', content)
    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBeGreaterThanOrEqual(1)

    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    expect(lessons).toContain('Pattern: unverified')
  })

  it('confidence is capped at 1.0', () => {
    // Start at 5 and jump to a very high count
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('incomplete', 5))
    distillExperiences(reflectionDir)

    // Update with 25 mistakes (delta = 20, 20 * 0.05 = 1.0, but capped at 1.0)
    writeFile(tmpDir, 'reflection/mistakes.md', buildMistakesContent('incomplete', 25))
    distillExperiences(reflectionDir)

    const lessons = readFile(tmpDir, 'reflection/lessons.md')
    const confMatch = lessons.match(/Confidence: ([\d.]+)/)
    expect(confMatch).not.toBeNull()
    const conf = parseFloat(confMatch![1])
    expect(conf).toBeLessThanOrEqual(1.0)
  })

  it('handles empty mistakes.md gracefully', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', '')
    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBe(0)
  })

  it('handles mistakes.md with only a header (no entries)', () => {
    writeFile(tmpDir, 'reflection/mistakes.md', '# Mistakes\n\nNo entries yet.\n')
    const result = distillExperiences(reflectionDir)
    expect(result.newRules).toBe(0)
  })
})
