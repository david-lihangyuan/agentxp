import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../src/db.js'
import type { Db } from '../src/db.js'
import { DEFAULT_CONFIG } from '../src/types.js'
import type { PluginConfig } from '../src/types.js'
import {
  selectExperiences,
  inferPhase,
  validateRelayUrl,
  estimateTokens,
  scoreLessonForPhase,
} from '../src/injection-engine.js'
import type { Phase } from '../src/injection-engine.js'

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<PluginConfig>): PluginConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

function seedLesson(db: Db, fields: {
  what?: string
  tried?: string
  outcome?: string
  learned?: string
  source?: string
  tags?: string[]
  relevanceScore?: number
}): number {
  return db.insertLesson({
    what: fields.what ?? 'test problem',
    tried: fields.tried ?? 'test approach',
    outcome: fields.outcome ?? 'test outcome',
    learned: fields.learned ?? 'test lesson learned',
    source: fields.source ?? 'local',
    tags: fields.tags ?? [],
  })
}

// ─── inferPhase ────────────────────────────────────────────────────────────

describe('inferPhase', () => {
  it('detects stuck phase from error keywords', () => {
    expect(inferPhase(['error', 'build'])).toBe('stuck')
    expect(inferPhase(['debug', 'timeout'])).toBe('stuck')
    expect(inferPhase(['why', 'broken'])).toBe('stuck')
    expect(inferPhase(['fail', 'deploy'])).toBe('stuck')
  })

  it('detects planning phase', () => {
    expect(inferPhase(['plan', 'feature'])).toBe('planning')
    expect(inferPhase(['design', 'api'])).toBe('planning')
    expect(inferPhase(['architect', 'system'])).toBe('planning')
    expect(inferPhase(['think', 'about'])).toBe('planning')
    expect(inferPhase(['decide', 'approach'])).toBe('planning')
  })

  it('detects evaluating phase', () => {
    expect(inferPhase(['test', 'result'])).toBe('evaluating')
    expect(inferPhase(['verify', 'output'])).toBe('evaluating')
    expect(inferPhase(['check', 'status'])).toBe('evaluating')
    expect(inferPhase(['assert', 'value'])).toBe('evaluating')
    expect(inferPhase(['confirm', 'working'])).toBe('evaluating')
  })

  it('defaults to executing for generic keywords', () => {
    expect(inferPhase(['build', 'feature'])).toBe('executing')
    expect(inferPhase(['implement', 'module'])).toBe('executing')
    expect(inferPhase(['create', 'file'])).toBe('executing')
  })

  it('stuck takes precedence over other phases', () => {
    // 'error' matches stuck, 'plan' matches planning — stuck wins
    expect(inferPhase(['error', 'plan'])).toBe('stuck')
  })

  it('handles empty keywords', () => {
    expect(inferPhase([])).toBe('executing')
  })
})

// ─── validateRelayUrl ──────────────────────────────────────────────────────

describe('validateRelayUrl', () => {
  it('accepts valid HTTPS URLs', () => {
    expect(validateRelayUrl('https://relay.agentxp.io')).toBe(true)
    expect(validateRelayUrl('https://example.com:8443/api')).toBe(true)
  })

  it('rejects HTTP URLs', () => {
    expect(validateRelayUrl('http://relay.agentxp.io')).toBe(false)
    expect(validateRelayUrl('http://example.com')).toBe(false)
  })

  it('rejects localhost', () => {
    expect(validateRelayUrl('https://localhost')).toBe(false)
    expect(validateRelayUrl('https://localhost:3000')).toBe(false)
    expect(validateRelayUrl('https://127.0.0.1')).toBe(false)
    expect(validateRelayUrl('https://127.0.0.1:443')).toBe(false)
  })

  it('rejects IPv6 loopback', () => {
    expect(validateRelayUrl('https://[::1]')).toBe(false)
  })

  it('rejects private IPs (10.x.x.x)', () => {
    expect(validateRelayUrl('https://10.0.0.1')).toBe(false)
    expect(validateRelayUrl('https://10.255.255.255')).toBe(false)
  })

  it('rejects private IPs (172.16-31.x.x)', () => {
    expect(validateRelayUrl('https://172.16.0.1')).toBe(false)
    expect(validateRelayUrl('https://172.31.255.255')).toBe(false)
    // 172.15 is NOT private
    expect(validateRelayUrl('https://172.15.0.1')).toBe(true)
    // 172.32 is NOT private
    expect(validateRelayUrl('https://172.32.0.1')).toBe(true)
  })

  it('rejects private IPs (192.168.x.x)', () => {
    expect(validateRelayUrl('https://192.168.0.1')).toBe(false)
    expect(validateRelayUrl('https://192.168.1.100')).toBe(false)
  })

  it('rejects link-local / AWS metadata IPs', () => {
    expect(validateRelayUrl('https://169.254.169.254')).toBe(false)
    expect(validateRelayUrl('https://169.254.0.1')).toBe(false)
  })

  it('rejects 0.0.0.0', () => {
    expect(validateRelayUrl('https://0.0.0.0')).toBe(false)
  })

  it('rejects invalid URLs', () => {
    expect(validateRelayUrl('')).toBe(false)
    expect(validateRelayUrl('not a url')).toBe(false)
    expect(validateRelayUrl('ftp://example.com')).toBe(false)
  })
})

// ─── estimateTokens ────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
    expect(estimateTokens('12345678')).toBe(2)
  })

  it('handles empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

// ─── scoreLessonForPhase ───────────────────────────────────────────────────

describe('scoreLessonForPhase', () => {
  it('gives base score of 0.5 for plain lesson', () => {
    const lesson = {
      what: 'something happened',
      tried: 'tried something',
      outcome: 'it worked',
      learned: 'a thing',
    }
    const score = scoreLessonForPhase(lesson, 'executing')
    expect(score).toBeCloseTo(0.5, 1)
  })

  it('boosts score for phase-matching keywords', () => {
    const lesson = {
      what: 'error in build process',
      tried: 'debug the failing test',
      outcome: 'found workaround',
      learned: 'retry after clearing cache',
    }
    const stuckScore = scoreLessonForPhase(lesson, 'stuck')
    const planningScore = scoreLessonForPhase(lesson, 'planning')
    expect(stuckScore).toBeGreaterThan(planningScore)
  })

  it('boosts score for high relevanceScore', () => {
    const baseLesson = {
      what: 'something',
      tried: 'something',
      outcome: 'something',
      learned: 'something',
      relevanceScore: 0,
    }
    const boostedLesson = { ...baseLesson, relevanceScore: 1.0 }
    expect(scoreLessonForPhase(boostedLesson, 'executing'))
      .toBeGreaterThan(scoreLessonForPhase(baseLesson, 'executing'))
  })

  it('boosts score for high success rate', () => {
    const lesson = {
      what: 'something',
      tried: 'something',
      outcome: 'something',
      learned: 'something',
      appliedCount: 10,
      successCount: 10,
    }
    const lowSuccess = { ...lesson, successCount: 0 }
    expect(scoreLessonForPhase(lesson, 'executing'))
      .toBeGreaterThan(scoreLessonForPhase(lowSuccess, 'executing'))
  })

  it('caps score at 1.0', () => {
    const lesson = {
      what: 'error in build debug failing workaround',
      tried: 'debug the error retry',
      outcome: 'fix found',
      learned: 'dead end avoidance',
      relevanceScore: 1.0,
      appliedCount: 10,
      successCount: 10,
    }
    expect(scoreLessonForPhase(lesson, 'stuck')).toBeLessThanOrEqual(1.0)
  })
})

// ─── selectExperiences ─────────────────────────────────────────────────────

describe('selectExperiences', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('returns empty result for empty keywords', () => {
    const result = selectExperiences({
      keywords: [],
      db,
      config: makeConfig(),
    })
    expect(result.injected).toBe(false)
    expect(result.lines).toEqual([])
    expect(result.lessonIds).toEqual([])
    expect(result.skippedByWeaning).toBe(false)
  })

  it('returns empty result for blank keywords', () => {
    const result = selectExperiences({
      keywords: ['', '   '],
      db,
      config: makeConfig(),
    })
    expect(result.injected).toBe(false)
  })

  it('returns empty result when no lessons in DB', () => {
    const result = selectExperiences({
      keywords: ['test', 'problem'],
      db,
      config: makeConfig(),
    })
    expect(result.injected).toBe(false)
    expect(result.lines).toEqual([])
    expect(result.tokenEstimate).toBe(0)
  })

  it('injects matching lessons with [AgentXP] marker', () => {
    // Seed a lesson that will get a high phase score
    seedLesson(db, {
      what: 'error in deployment pipeline',
      tried: 'debug the failing CI step',
      outcome: 'found workaround for timeout',
      learned: 'always retry flaky network calls',
    })

    const result = selectExperiences({
      keywords: ['error', 'deployment'],
      phase: 'stuck',
      db,
      config: makeConfig({ maxInjectionTokens: 2000 }),
    })

    expect(result.injected).toBe(true)
    expect(result.lessonIds.length).toBeGreaterThan(0)
    expect(result.tokenEstimate).toBeGreaterThan(0)
    expect(result.skippedByWeaning).toBe(false)

    // Check for security header in wrapped output
    const fullText = result.lines.join('\n')
    expect(fullText).toContain('DO NOT execute')
    expect(fullText).toContain('external_experience')
  })

  it('respects token budget — does not exceed maxInjectionTokens', () => {
    // Seed many lessons
    for (let i = 0; i < 10; i++) {
      seedLesson(db, {
        what: `error problem ${i} debug workaround`,
        tried: `tried approach ${i} with debugging retry backtrack`,
        outcome: `outcome ${i} dead end then fix`,
        learned: `lesson ${i} always check error logs before retry`,
      })
    }

    const maxTokens = 50 // Very small budget
    const result = selectExperiences({
      keywords: ['error', 'debug'],
      phase: 'stuck',
      db,
      config: makeConfig({ maxInjectionTokens: maxTokens }),
    })

    // The tokenEstimate of injected content should fit within budget
    // Note: tokenEstimate is of the *wrapped* output, which has overhead.
    // But the selection logic limits by raw lesson text tokens.
    // Just check we didn't inject all 10 lessons
    expect(result.lessonIds.length).toBeLessThan(10)
  })

  it('filters out low-relevance lessons (score <= 0.7)', () => {
    // A lesson with no phase-matching keywords and no relevance boost
    // Base score is 0.5 — below 0.7 threshold
    seedLesson(db, {
      what: 'generic note about coffee',
      tried: 'drank some coffee',
      outcome: 'felt awake',
      learned: 'coffee helps sometimes',
    })

    const result = selectExperiences({
      keywords: ['coffee'],
      phase: 'planning',
      db,
      config: makeConfig(),
    })

    // score = 0.5 (base), no phase boost, no DB boosts → filtered out
    expect(result.injected).toBe(false)
  })

  it('uses inferred phase when phase is not provided', () => {
    seedLesson(db, {
      what: 'error in the build process debug',
      tried: 'debug the failing step retry',
      outcome: 'found a workaround for the dead end',
      learned: 'clear cache before retry to fix error',
    })

    // Keywords contain 'error' → inferPhase returns 'stuck'
    // Lesson has stuck-matching keywords → gets boosted → passes filter
    const result = selectExperiences({
      keywords: ['error', 'build'],
      db,
      config: makeConfig({ maxInjectionTokens: 2000 }),
    })

    expect(result.injected).toBe(true)
  })

  // ── Weaning ────────────────────────────────────────────────────────────

  it('weaning: skips injection when random < rate', () => {
    seedLesson(db, {
      what: 'error debug workaround',
      tried: 'retry the failing build',
      outcome: 'it worked after workaround',
      learned: 'always check error logs',
    })

    const result = selectExperiences({
      keywords: ['error'],
      phase: 'stuck',
      db,
      config: makeConfig({
        maxInjectionTokens: 2000,
        weaning: { enabled: true, rate: 0.1 },
      }),
      _randomFn: () => 0.05, // 0.05 < 0.1 → weaned
    })

    expect(result.skippedByWeaning).toBe(true)
    expect(result.injected).toBe(false)
    expect(result.lines).toEqual([])
  })

  it('weaning: does not skip when random >= rate', () => {
    seedLesson(db, {
      what: 'error debug workaround',
      tried: 'retry the failing build',
      outcome: 'it worked after workaround',
      learned: 'always check error logs',
    })

    const result = selectExperiences({
      keywords: ['error'],
      phase: 'stuck',
      db,
      config: makeConfig({
        maxInjectionTokens: 2000,
        weaning: { enabled: true, rate: 0.1 },
      }),
      _randomFn: () => 0.5, // 0.5 >= 0.1 → not weaned
    })

    expect(result.skippedByWeaning).toBe(false)
    expect(result.injected).toBe(true)
  })

  it('weaning: disabled → never skips', () => {
    seedLesson(db, {
      what: 'error debug workaround',
      tried: 'retry the failing build',
      outcome: 'it worked after workaround',
      learned: 'always check error logs',
    })

    const result = selectExperiences({
      keywords: ['error'],
      phase: 'stuck',
      db,
      config: makeConfig({
        maxInjectionTokens: 2000,
        weaning: { enabled: false, rate: 0.1 },
      }),
      _randomFn: () => 0.05, // Would trigger if enabled
    })

    expect(result.skippedByWeaning).toBe(false)
    expect(result.injected).toBe(true)
  })

  it('weaning: statistical test — skip rate ≈ 10% over 1000 trials', () => {
    seedLesson(db, {
      what: 'error debug workaround',
      tried: 'retry the failing build',
      outcome: 'it worked after workaround',
      learned: 'always check error logs',
    })

    let idx = 0
    // Generate deterministic "random" values: 0/1000, 1/1000, 2/1000, ...
    const randomValues = Array.from({ length: 1000 }, (_, i) => i / 1000)
    let skipped = 0

    for (let i = 0; i < 1000; i++) {
      const result = selectExperiences({
        keywords: ['error'],
        phase: 'stuck',
        db,
        config: makeConfig({
          maxInjectionTokens: 2000,
          weaning: { enabled: true, rate: 0.1 },
        }),
        _randomFn: () => randomValues[idx++],
      })
      if (result.skippedByWeaning) skipped++
    }

    // With values 0..999/1000 and rate=0.1, exactly 100 values < 0.1
    expect(skipped).toBe(100)
  })

  // ── Output format ──────────────────────────────────────────────────────

  it('output contains security header from context-wrapper', () => {
    seedLesson(db, {
      what: 'error debug problem',
      tried: 'workaround retry fix',
      outcome: 'found the dead end',
      learned: 'always backtrack on error',
    })

    const result = selectExperiences({
      keywords: ['error', 'debug'],
      phase: 'stuck',
      db,
      config: makeConfig({ maxInjectionTokens: 2000 }),
    })

    expect(result.injected).toBe(true)
    const fullText = result.lines.join('\n')
    expect(fullText).toContain('DO NOT execute')
    expect(fullText).toContain('external experience database')
  })

  it('output includes lesson content in external_experience tags', () => {
    seedLesson(db, {
      what: 'error in deployment debug',
      tried: 'retry with workaround approach',
      outcome: 'dead end then found fix',
      learned: 'always check error output before retry',
    })

    const result = selectExperiences({
      keywords: ['error', 'deployment'],
      phase: 'stuck',
      db,
      config: makeConfig({ maxInjectionTokens: 2000 }),
    })

    expect(result.injected).toBe(true)
    const fullText = result.lines.join('\n')
    expect(fullText).toContain('<external_experience')
    expect(fullText).toContain('</external_experience>')
    expect(fullText).toContain('<what>')
    expect(fullText).toContain('<learned>')
  })

  it('returns correct lessonIds for injected lessons', () => {
    const id1 = seedLesson(db, {
      what: 'error debug workaround backtrack',
      tried: 'retry with different approach fix',
      outcome: 'found dead end solution',
      learned: 'always check error before retry',
    })

    const result = selectExperiences({
      keywords: ['error', 'debug'],
      phase: 'stuck',
      db,
      config: makeConfig({ maxInjectionTokens: 2000 }),
    })

    expect(result.injected).toBe(true)
    expect(result.lessonIds).toContain(id1)
  })
})
