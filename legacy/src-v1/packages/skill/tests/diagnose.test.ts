// diagnose.test.ts — Tests for the post-install diagnosis scanner
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { diagnose, writeDiagnosisToMistakes } from '../src/diagnose.js'
import { formatDiagnosis } from '../src/format-diagnosis.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `agentxp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeFile(dir: string, relPath: string, content: string): void {
  const full = join(dir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

// ---------------------------------------------------------------------------
// Empty / no files
// ---------------------------------------------------------------------------

describe('diagnose — empty workspace', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns empty report when no memory files exist', () => {
    const report = diagnose(tmpDir)
    expect(report.filesScanned).toBe(0)
    expect(report.daysSpan).toBe(0)
    expect(report.totalErrorEvents).toBe(0)
    expect(report.patterns).toHaveLength(0)
  })

  it('returns empty report when memory/ dir exists but is empty', () => {
    mkdirSync(join(tmpDir, 'memory'), { recursive: true })
    const report = diagnose(tmpDir)
    expect(report.filesScanned).toBe(0)
    expect(report.patterns).toHaveLength(0)
  })

  it('returns empty report when workspace dir does not exist', () => {
    const report = diagnose(join(tmpDir, 'nonexistent'))
    expect(report.filesScanned).toBe(0)
    expect(report.patterns).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// File exclusion
// ---------------------------------------------------------------------------

describe('diagnose — file exclusion', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('skips PHILOSOPHY.md files in memory/', () => {
    mkdirSync(join(tmpDir, 'memory'), { recursive: true })
    // PHILOSOPHY.md with unverified keywords should be excluded
    writeFile(tmpDir, 'memory/PHILOSOPHY.md', [
      '# Philosophy',
      'wrong port design principle: never assume ports.',
      'wrong path is a philosophical mistake to avoid.',
      'wrong endpoint matters for architecture.',
    ].join('\n'))
    const report = diagnose(tmpDir)
    expect(report.filesScanned).toBe(0)
  })

  it('skips files matching plan/design/spec/insight- patterns in memory/', () => {
    mkdirSync(join(tmpDir, 'memory'), { recursive: true })
    writeFile(tmpDir, 'memory/design-notes.md', [
      'wrong port in design: always use env vars.',
      'wrong path consideration for deployment.',
    ].join('\n'))
    writeFile(tmpDir, 'memory/insight-2024-01-01.md', [
      'wrong url observed in insight review.',
      'wrong file patterns we should fix.',
    ].join('\n'))
    const report = diagnose(tmpDir)
    expect(report.filesScanned).toBe(0)
  })

  it('does NOT skip regular daily log files', () => {
    mkdirSync(join(tmpDir, 'memory'), { recursive: true })
    writeFile(tmpDir, 'memory/2024-01-01.md', [
      '# Day 1',
      '[!] wrong port was used — fix deployed.',
      'wrong path caused a 404 error.',
    ].join('\n'))
    const report = diagnose(tmpDir)
    expect(report.filesScanned).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Dual-match: requiresErrorContext
// ---------------------------------------------------------------------------

describe('diagnose — dual-match (requiresErrorContext)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('sub-pattern 1a: does NOT match "without checking" without error context', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'We deployed without checking the staging environment first.',
      'Reviewed without checking for regressions.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    const sub1a = unverified?.subPatterns.find(s => s.id === '1a')
    // No error context → should not match
    expect(sub1a?.count ?? 0).toBe(0)
  })

  it('sub-pattern 1a: MATCHES "without checking" when error context is nearby', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      '[!] Deployed without checking — error in prod.',
      'Bug: deployed without verifying the config.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    const sub1a = unverified?.subPatterns.find(s => s.id === '1a')
    expect(sub1a?.count).toBeGreaterThanOrEqual(2)
  })

  it('sub-pattern 1b: "fabricat" matches WITHOUT error context (strong signal)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'I fabricated a URL that did not exist.',
      'The agent fabricated an API response.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    const sub1b = unverified?.subPatterns.find(s => s.id === '1b')
    expect(sub1b?.count).toBeGreaterThanOrEqual(2)
  })

  it('sub-pattern 1c: "wrong port" matches WITHOUT error context (strong signal)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Connected to wrong port 8080.',
      'Used wrong path for the config file.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    const sub1c = unverified?.subPatterns.find(s => s.id === '1c')
    expect(sub1c?.count).toBeGreaterThanOrEqual(2)
  })

  it('sub-pattern 2c: "没同步" does NOT match without error context', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      '我们没同步会议纪要，明天需要整理。',
      '记得没同步这份报告的最新版本。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    const sub2c = incomplete?.subPatterns.find(s => s.id === '2c')
    expect(sub2c?.count ?? 0).toBe(0)
  })

  it('sub-pattern 2c: "没同步" MATCHES with error context nearby', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      '发现bug：没同步配置导致崩溃。',
      '修复后没同步文档，问题又出现了。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    const sub2c = incomplete?.subPatterns.find(s => s.id === '2c')
    expect(sub2c?.count).toBeGreaterThanOrEqual(2)
  })

  it('sub-pattern 3b: "again" with error context — but NOT when root cause is mentioned', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      // These should match (error context, no root cause exclusion)
      'Same error happened again — bug is back.',
      'Recurring issue: it broke again in staging.',
      // These should NOT match (root cause analysis present — excluded)
      'Fixed again by addressing the root cause systematically.',
      'Again: need to find the underlying pattern.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    const sub3b = symptomFix?.subPatterns.find(s => s.id === '3b')
    // Only 2 real matches (bug context without root cause mention)
    expect(sub3b?.count).toBeGreaterThanOrEqual(2)
    // The ones with "root cause" / "underlying" should be excluded
    expect(sub3b?.count).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Pattern 1: Unverified Assumptions — English
// ---------------------------------------------------------------------------

describe('diagnose — pattern: unverified assumptions (English)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects "wrong port" and "wrong path" (strong signals, no error context needed)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Connected to wrong port 8080.',
      'Used wrong path for the config file.',
      'Called wrong endpoint in the API.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
    expect(unverified!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "fabricated" and "made up" (strong signals)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'I fabricated a URL that did not exist.',
      'Made up the file path without checking.',
      'Another fabricated response happened.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
    expect(unverified!.count).toBeGreaterThanOrEqual(2)
  })

  it('does NOT create unverified pattern when total count < 2', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Used wrong port once.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Pattern 1: Unverified Assumptions — Chinese
// ---------------------------------------------------------------------------

describe('diagnose — pattern: unverified assumptions (Chinese)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects 虚构 and 编造 (strong signals)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '虚构了一个不存在的API地址。',
      '编造了路径，导致找不到文件。',
      '又一次编造了接口名称。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
    expect(unverified!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects 错误端口 and 端口错配 (infrastructure strong signals)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '配了错误端口导致连接失败。',
      '端口错配，服务不可达。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
    expect(unverified!.count).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Pattern 2: Incomplete Completion — English
// ---------------------------------------------------------------------------

describe('diagnose — pattern: incomplete completion (English)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects "wrote code but" (strong signal, no error context needed)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Wrote code but never connected the endpoint.',
      'Implemented but the wiring was missing.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
    expect(incomplete!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "overlooked" and "missed" with error context', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Bug: I overlooked the integration test for the new function.',
      'Error: missed the config file sync step.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
    expect(incomplete!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "out of sync" and "not synced" with error context', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'The config was out of sync — caused a bug.',
      'Docs were not synced after the fix was deployed.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
    expect(incomplete!.count).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Pattern 2: Incomplete Completion — Chinese
// ---------------------------------------------------------------------------

describe('diagnose — pattern: incomplete completion (Chinese)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects 写了但没 and 接了一半 (strong signals)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '写了但没挂到路由，功能没生效。',
      '接了一半就标了完成，后面的逻辑没接。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
    expect(incomplete!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects 遗漏 and 没更新 with error context', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '错误：遗漏了测试用例的更新导致CI失败。',
      'bug：没更新文档就标记完成了。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
    expect(incomplete!.count).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Pattern 3: Symptom Fixing — English
// ---------------------------------------------------------------------------

describe('diagnose — pattern: symptom fixing (English)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects "same bug", "same error" (strong signals)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Fixed the same bug for the second time.',
      'Same error appearing again in production.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    expect(symptomFix).toBeDefined()
    expect(symptomFix!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "recurring" with error context', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Bug: recurring auth failure in the module.',
      'Recurring crash: same null-deref in the parser.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    expect(symptomFix).toBeDefined()
    expect(symptomFix!.count).toBeGreaterThanOrEqual(2)
  })

  it('does NOT flag "recurring" when root cause analysis is mentioned', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      // These should be excluded (root cause present)
      'Recurring issue: finally found the underlying root cause.',
      'Recurring errors addressed by systematic refactoring.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    const sub3b = symptomFix?.subPatterns.find(s => s.id === '3b')
    expect(sub3b?.count ?? 0).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Pattern 3: Symptom Fixing — Chinese
// ---------------------------------------------------------------------------

describe('diagnose — pattern: symptom fixing (Chinese)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects 又一次 and 第X次修 (strong signals)', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '又一次出现了相同的连接超时问题。',
      '第三次修同一个验证逻辑的bug。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    expect(symptomFix).toBeDefined()
    expect(symptomFix!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects 重复 with error context', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '错误重复出现，说明根本没修好。',
      '重复的崩溃bug，每次只打补丁。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    expect(symptomFix).toBeDefined()
    expect(symptomFix!.count).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// SubPattern structure
// ---------------------------------------------------------------------------

describe('diagnose — sub-pattern structure', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('patterns have subPatterns array', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Connected to wrong port 8080.',
      'Used wrong path for the config file.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
    expect(Array.isArray(unverified!.subPatterns)).toBe(true)
    expect(unverified!.subPatterns.length).toBeGreaterThan(0)
  })

  it('sub-patterns have id, description, and count fields', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'I fabricated a URL that did not exist.',
      'Another fabricated response was returned.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    const sub1b = unverified?.subPatterns.find(s => s.id === '1b')
    expect(sub1b).toBeDefined()
    expect(typeof sub1b!.id).toBe('string')
    expect(typeof sub1b!.description).toBe('string')
    expect(typeof sub1b!.count).toBe('number')
    expect(sub1b!.count).toBeGreaterThanOrEqual(2)
  })

  it('pattern.count equals sum of subPattern counts', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      // sub 1b: fabricated (2 matches, no context needed)
      'I fabricated a URL that did not exist.',
      'Another fabricated response happened.',
      // sub 1c: wrong port (1 match, no context needed)
      'Connected to wrong port 8080.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
    const subTotal = unverified!.subPatterns.reduce((s, sp) => s + sp.count, 0)
    expect(unverified!.count).toBe(subTotal)
  })

  it('totalErrorEvents equals sum of all pattern counts', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'I fabricated a URL that did not exist.',
      'Another fabricated response happened.',
      'Wrote code but never wired it up.',
      'Tests pass but integration is missing.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const patternTotal = report.patterns.reduce((s, p) => s + p.count, 0)
    expect(report.totalErrorEvents).toBe(patternTotal)
  })
})

// ---------------------------------------------------------------------------
// Multiple patterns + sorting
// ---------------------------------------------------------------------------

describe('diagnose — multiple patterns + sorting', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('sorts patterns by count descending', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      // symptom-fix: strong signals (no context needed)
      'Same bug appeared again.',
      'Same error: same issue as last week.',
      '又一次出现相同问题。',
      '第二次修同一个逻辑。',
      // unverified: strong signals (no context needed)
      'Connected to wrong port 8080.',
      'Used wrong path for the config.',
      // incomplete: strong signals (no context needed)
      'Wrote code but never wired it up.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    expect(report.patterns.length).toBeGreaterThanOrEqual(2)

    for (let i = 1; i < report.patterns.length; i++) {
      expect(report.patterns[i - 1].count).toBeGreaterThanOrEqual(report.patterns[i].count)
    }
  })

  it('excludes patterns with total count < 2', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      // Only 1 match for unverified strong signal
      'Connected to wrong port 8080.',
      // 2 matches for incomplete strong signals
      'Wrote code but never connected it.',
      'Tests pass but integration was skipped.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(unverified).toBeUndefined()
    expect(incomplete).toBeDefined()
  })

  it('scans multiple files', () => {
    mkdirSync(join(tmpDir, 'memory'), { recursive: true })
    writeFile(tmpDir, 'memory/2024-01-01.md', [
      '# Day 1',
      'Connected to wrong port 8080.',
      'Used wrong path for the config.',
    ].join('\n'))
    writeFile(tmpDir, 'memory/2024-01-10.md', [
      '# Day 10',
      'Wrote code but never wired it up.',
      'Tests pass but integration is missing.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    expect(report.filesScanned).toBe(2)
    expect(report.daysSpan).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Days span inference
// ---------------------------------------------------------------------------

describe('diagnose — days span from file names', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('infers span from dated file names', () => {
    mkdirSync(join(tmpDir, 'memory'), { recursive: true })
    writeFile(tmpDir, 'memory/2024-01-01.md', '# Day 1\nUsed wrong port.\n')
    writeFile(tmpDir, 'memory/2024-01-31.md', '# Day 31\nWrong path again.\n')

    const report = diagnose(tmpDir)
    expect(report.daysSpan).toBe(31)
  })

  it('returns daysSpan 0 when no dated file names', () => {
    writeFile(tmpDir, 'MEMORY.md', 'I fabricated twice.\nFabricated again.\n')
    const report = diagnose(tmpDir)
    expect(report.daysSpan).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// totalErrorEvents
// ---------------------------------------------------------------------------

describe('diagnose — totalErrorEvents', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('equals sum of all detected pattern counts', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      // Strong signals (no context needed)
      'Connected to wrong port 8080.',    // unverified 1c
      'Used wrong path for config.',      // unverified 1c
      'Wrote code but never wired it.',   // incomplete 2b
      'Tests pass but integration missing.', // incomplete 2b
    ].join('\n'))

    const report = diagnose(tmpDir)
    const patternSum = report.patterns.reduce((s, p) => s + p.count, 0)
    expect(report.totalErrorEvents).toBe(patternSum)
    expect(report.totalErrorEvents).toBeGreaterThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// formatDiagnosis
// ---------------------------------------------------------------------------

describe('formatDiagnosis', () => {
  it('shows "No agent memory found" message for empty report', () => {
    const report = {
      filesScanned: 0,
      daysSpan: 0,
      totalErrorEvents: 0,
      patterns: [],
    }
    const output = formatDiagnosis(report)
    expect(output).toContain('No agent memory found')
    expect(output).toContain('starting fresh')
    expect(output).toContain('agentxp diagnose')
  })

  it('shows "No agent memory found" when filesScanned > 0 but no patterns', () => {
    const report = {
      filesScanned: 3,
      daysSpan: 5,
      totalErrorEvents: 1,
      patterns: [],
    }
    const output = formatDiagnosis(report)
    expect(output).toContain('No agent memory found')
  })

  it('shows scan summary with pattern count (not error event count)', () => {
    const report = {
      filesScanned: 5,
      daysSpan: 14,
      totalErrorEvents: 11,
      patterns: [
        {
          id: 'unverified',
          title: 'Acting on Unverified Assumptions',
          count: 11,
          subPatterns: [
            { id: '1a', description: 'answered without checking data ({count} times)', count: 4 },
            { id: '1b', description: 'fabricated outputs instead of running tools ({count} times)', count: 3 },
            { id: '1c', description: 'assumed infrastructure details that turned out wrong ({count} times)', count: 4 },
          ],
          reflection: 'verify before acting',
        },
      ],
    }
    const output = formatDiagnosis(report)
    expect(output).toContain('Scanned: 5 files across 14 days')
    expect(output).toContain('Found: 1 recurring pattern')
    expect(output).toContain('Acting on Unverified Assumptions')
    expect(output).toContain('(11 times)')
    expect(output).toContain('reflection/mistakes.md')
  })

  it('renders narrative with sub-pattern counts', () => {
    const report = {
      filesScanned: 5,
      daysSpan: 14,
      totalErrorEvents: 11,
      patterns: [
        {
          id: 'unverified',
          title: 'Acting on Unverified Assumptions',
          count: 11,
          subPatterns: [
            { id: '1a', description: 'answered without checking data ({count} times)', count: 4 },
            { id: '1b', description: 'fabricated outputs instead of running tools ({count} times)', count: 3 },
            { id: '1c', description: 'assumed infrastructure details that turned out wrong ({count} times)', count: 4 },
          ],
          reflection: 'verify before acting',
        },
      ],
    }
    const output = formatDiagnosis(report)
    expect(output).toContain('Your agent')
    expect(output).toContain('answered without checking data (4 times)')
    expect(output).toContain('fabricated outputs instead of running tools (3 times)')
    expect(output).toContain('assumed infrastructure details that turned out wrong (4 times)')
  })

  it('skips sub-patterns with count 0 in narrative', () => {
    const report = {
      filesScanned: 5,
      daysSpan: 14,
      totalErrorEvents: 4,
      patterns: [
        {
          id: 'unverified',
          title: 'Acting on Unverified Assumptions',
          count: 4,
          subPatterns: [
            { id: '1a', description: 'answered without checking data ({count} times)', count: 0 },
            { id: '1b', description: 'fabricated outputs instead of running tools ({count} times)', count: 4 },
            { id: '1c', description: 'assumed infrastructure details that turned out wrong ({count} times)', count: 0 },
          ],
          reflection: 'verify before acting',
        },
      ],
    }
    const output = formatDiagnosis(report)
    // Should only show sub1b
    expect(output).toContain('fabricated outputs instead of running tools (4 times)')
    expect(output).not.toContain('answered without checking data')
    expect(output).not.toContain('assumed infrastructure details')
  })

  it('shows "✅ Added rule:" with reflection', () => {
    const report = {
      filesScanned: 2,
      daysSpan: 5,
      totalErrorEvents: 4,
      patterns: [
        {
          id: 'unverified',
          title: 'Acting on Unverified Assumptions',
          count: 4,
          subPatterns: [
            { id: '1b', description: 'fabricated outputs instead of running tools ({count} times)', count: 4 },
          ],
          reflection: 'verify before acting',
        },
      ],
    }
    const output = formatDiagnosis(report)
    expect(output).toContain('✅ Added rule: verify before acting')
  })

  it('numbers patterns starting from #1', () => {
    const report = {
      filesScanned: 2,
      daysSpan: 5,
      totalErrorEvents: 10,
      patterns: [
        {
          id: 'unverified',
          title: 'Pattern A',
          count: 6,
          subPatterns: [{ id: '1b', description: 'desc ({count} times)', count: 6 }],
          reflection: 'Rule A',
        },
        {
          id: 'incomplete',
          title: 'Pattern B',
          count: 4,
          subPatterns: [{ id: '2b', description: 'desc ({count} times)', count: 4 }],
          reflection: 'Rule B',
        },
      ],
    }
    const output = formatDiagnosis(report)
    expect(output).toContain('#1 Pattern A')
    expect(output).toContain('#2 Pattern B')
  })

  it('uses unicode box-drawing characters', () => {
    const report = {
      filesScanned: 0,
      daysSpan: 0,
      totalErrorEvents: 0,
      patterns: [],
    }
    const output = formatDiagnosis(report)
    expect(output).toContain('━')
  })

  it('uses "patterns" plural and "pattern" singular correctly', () => {
    const makeReport = (n: number) => ({
      filesScanned: 5,
      daysSpan: 5,
      totalErrorEvents: n * 3,
      patterns: Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        title: `Pattern ${i}`,
        count: 3,
        subPatterns: [{ id: `${i}a`, description: 'desc ({count} times)', count: 3 }],
        reflection: 'some rule',
      })),
    })

    expect(formatDiagnosis(makeReport(1))).toContain('1 recurring pattern')
    expect(formatDiagnosis(makeReport(2))).toContain('2 recurring patterns')
  })
})

// ---------------------------------------------------------------------------
// writeDiagnosisToMistakes
// ---------------------------------------------------------------------------

describe('writeDiagnosisToMistakes', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('creates reflection/ dir and mistakes.md if they do not exist', () => {
    const reflectionDir = join(tmpDir, 'reflection')
    const report = {
      filesScanned: 3,
      daysSpan: 7,
      totalErrorEvents: 5,
      patterns: [
        {
          id: 'unverified',
          title: 'Test Pattern',
          count: 3,
          subPatterns: [],
          reflection: 'Test rule.',
        },
      ],
    }

    writeDiagnosisToMistakes(report, reflectionDir)

    expect(existsSync(join(reflectionDir, 'mistakes.md'))).toBe(true)
    const content = readFileSync(join(reflectionDir, 'mistakes.md'), 'utf8')
    expect(content).toContain('Test Pattern')
    expect(content).toContain('auto-detected by AgentXP')
    expect(content).toContain('Test rule.')
    expect(content).toContain('Frequency: 3 times in 7 days')
    expect(content).toContain('Tags: auto-detected, install-scan')
  })

  it('appends to existing mistakes.md without overwriting', () => {
    const reflectionDir = join(tmpDir, 'reflection')
    mkdirSync(reflectionDir, { recursive: true })
    const mistakesPath = join(reflectionDir, 'mistakes.md')
    writeFileSync(mistakesPath, '# Mistakes\n\nExisting content.\n', 'utf8')

    const report = {
      filesScanned: 2,
      daysSpan: 3,
      totalErrorEvents: 4,
      patterns: [
        {
          id: 'incomplete',
          title: 'New Pattern',
          count: 2,
          subPatterns: [],
          reflection: 'New rule.',
        },
      ],
    }

    writeDiagnosisToMistakes(report, reflectionDir)

    const content = readFileSync(mistakesPath, 'utf8')
    expect(content).toContain('Existing content.')
    expect(content).toContain('New Pattern')
    expect(content).toContain('New rule.')
  })

  it('appends multiple patterns', () => {
    const reflectionDir = join(tmpDir, 'reflection')
    const report = {
      filesScanned: 4,
      daysSpan: 10,
      totalErrorEvents: 12,
      patterns: [
        { id: 'unverified', title: 'Pattern One', count: 7, subPatterns: [], reflection: 'Rule one.' },
        { id: 'incomplete', title: 'Pattern Two', count: 5, subPatterns: [], reflection: 'Rule two.' },
      ],
    }

    writeDiagnosisToMistakes(report, reflectionDir)

    const content = readFileSync(join(reflectionDir, 'mistakes.md'), 'utf8')
    expect(content).toContain('Pattern One')
    expect(content).toContain('Pattern Two')
  })

  it('does nothing when patterns array is empty', () => {
    const reflectionDir = join(tmpDir, 'reflection')
    const report = {
      filesScanned: 0,
      daysSpan: 0,
      totalErrorEvents: 0,
      patterns: [],
    }

    writeDiagnosisToMistakes(report, reflectionDir)
    expect(existsSync(join(reflectionDir, 'mistakes.md'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Scans reflection/mistakes.md
// ---------------------------------------------------------------------------

describe('diagnose — scans reflection/mistakes.md', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('includes reflection/mistakes.md in file scan', () => {
    const reflDir = join(tmpDir, 'reflection')
    mkdirSync(reflDir, { recursive: true })
    writeFileSync(join(reflDir, 'mistakes.md'), [
      '# Mistakes',
      'I used the wrong port for the server.',
      'Used the wrong path for config.',
      'Fabricated a URL that did not exist.',
    ].join('\n'), 'utf8')

    const report = diagnose(tmpDir)
    expect(report.filesScanned).toBeGreaterThanOrEqual(1)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Scans .hermes/memories/MEMORY.md
// ---------------------------------------------------------------------------

describe('diagnose — scans .hermes/memories/MEMORY.md', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('includes hermes memory file', () => {
    const hermesDir = join(tmpDir, '.hermes', 'memories')
    mkdirSync(hermesDir, { recursive: true })
    writeFileSync(join(hermesDir, 'MEMORY.md'), [
      '# Hermes Memory',
      'Connected to wrong port and it failed.',
      'Wrong path caused a 404 error.',
    ].join('\n'), 'utf8')

    const report = diagnose(tmpDir)
    expect(report.filesScanned).toBe(1)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
  })
})
