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
// Pattern 1: Unverified Assumptions (English)
// ---------------------------------------------------------------------------

describe('diagnose — pattern: unverified assumptions (English)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects "assumed" and "turned out" keywords', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'I assumed the port was 3000 but turned out it was 4000.',
      'Again I assumed the path was correct without checking.',
      'Third time: assumed wrong URL.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
    expect(unverified!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "fabricated" and "hallucinate"', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'I fabricated a URL that did not exist.',
      'The model hallucinated the file path.',
      'Another hallucinate event happened.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
    expect(unverified!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "wrong port", "wrong path", "wrong endpoint"', () => {
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

  it('does NOT create unverified pattern when count < 2', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'I assumed the port once.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Pattern 1: Unverified Assumptions (Chinese)
// ---------------------------------------------------------------------------

describe('diagnose — pattern: unverified assumptions (Chinese)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects Chinese keywords 没验证, 想当然, 以为', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '没验证就直接部署了，导致出错。',
      '想当然以为文件在那个路径。',
      '以为端口是正确的，实际不对。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
    expect(unverified!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects 虚构 and 编造 keywords', () => {
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
})

// ---------------------------------------------------------------------------
// Pattern 2: Incomplete Completion (English)
// ---------------------------------------------------------------------------

describe('diagnose — pattern: incomplete completion (English)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects "forgot to", "missed", "overlooked"', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'I forgot to update the documentation.',
      'Missed the config file sync.',
      'Overlooked the test for the new function.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
    expect(incomplete!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "out of sync", "not synced"', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'The config was out of sync with the code.',
      'The docs were not synced after the change.',
      'State became out of sync again.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
    expect(incomplete!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "only half", "partially", "incomplete"', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Only half the tests were passing.',
      'Work was partially complete when marked done.',
      'Implementation was incomplete at review time.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Pattern 2: Incomplete Completion (Chinese)
// ---------------------------------------------------------------------------

describe('diagnose — pattern: incomplete completion (Chinese)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects 遗漏, 没更新, 没同步', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '遗漏了测试用例的更新。',
      '没更新文档就标记完成了。',
      '没同步配置文件。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
    expect(incomplete!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects 脱节 and 只做了一半', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '代码和文档脱节，没有同步更新。',
      '只做了一半就提交了。',
      '接了一半的任务就说完成了。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    expect(incomplete).toBeDefined()
    expect(incomplete!.count).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Pattern 3: Symptom Fixing (English)
// ---------------------------------------------------------------------------

describe('diagnose — pattern: symptom fixing (English)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects "same bug", "same error", "recurring"', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Fixed the same bug for the second time.',
      'Same error appearing again in production.',
      'This is a recurring problem with the auth module.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    expect(symptomFix).toBeDefined()
    expect(symptomFix!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "root cause", "systematic"', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Did not find the root cause, same error came back.',
      'This looks systematic — same error pattern repeated.',
      'Need to address the root cause not just the symptom.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    expect(symptomFix).toBeDefined()
    expect(symptomFix!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects "again", "second time"', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'Same issue happened again after the hotfix.',
      'Fixed it a second time with the same workaround.',
      'Came back again — clearly not the root cause.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    expect(symptomFix).toBeDefined()
    expect(symptomFix!.count).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Pattern 3: Symptom Fixing (Chinese)
// ---------------------------------------------------------------------------

describe('diagnose — pattern: symptom fixing (Chinese)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTempDir() })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('detects 同类, 同样的, 重复', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '同类错误再次出现，没有从根本解决。',
      '同样的问题昨天也发生过。',
      '重复修复了同一个问题。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    expect(symptomFix).toBeDefined()
    expect(symptomFix!.count).toBeGreaterThanOrEqual(2)
  })

  it('detects 又一次 and 第X次修', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# 记忆',
      '又一次出现了相同的连接超时问题。',
      '第三次修同一个验证逻辑的bug。',
      '又一次没有找到根本原因。',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const symptomFix = report.patterns.find(p => p.id === 'symptom-fix')
    expect(symptomFix).toBeDefined()
    expect(symptomFix!.count).toBeGreaterThanOrEqual(2)
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
      // symptom-fix: 5 matches
      'Same bug again and again.',
      'Same error recurring in prod.',
      'Same issue happened again.',
      'This is repeated and systematic.',
      'Root cause was never found — same bug.',
      // unverified: 3 matches
      'I assumed the config was right.',
      'Turned out the path was wrong.',
      'Used wrong file without checking.',
      // incomplete: 2 matches
      'Forgot to sync the docs.',
      'Work was out of sync.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    expect(report.patterns.length).toBeGreaterThanOrEqual(2)

    for (let i = 1; i < report.patterns.length; i++) {
      expect(report.patterns[i - 1].count).toBeGreaterThanOrEqual(report.patterns[i].count)
    }
  })

  it('excludes patterns with count < 2', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      // Only 1 match for unverified — should NOT appear
      'I assumed the port once.',
      // 3 matches for incomplete — should appear
      'Forgot to update the docs.',
      'Out of sync config again.',
      'Missed the integration test.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    const incomplete = report.patterns.find(p => p.id === 'incomplete')
    // unverified has only 1 match → excluded
    expect(unverified).toBeUndefined()
    // incomplete has 3 matches → included
    expect(incomplete).toBeDefined()
  })

  it('scans multiple files', () => {
    mkdirSync(join(tmpDir, 'memory'), { recursive: true })
    writeFile(tmpDir, 'memory/2024-01-01.md', [
      '# Day 1',
      'I assumed the API endpoint was correct.',
      'Turned out the URL was wrong.',
    ].join('\n'))
    writeFile(tmpDir, 'memory/2024-01-10.md', [
      '# Day 10',
      'Forgot to sync the config.',
      'Missed the migration file.',
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
    writeFile(tmpDir, 'memory/2024-01-01.md', '# Day 1\nI assumed something.\n')
    writeFile(tmpDir, 'memory/2024-01-31.md', '# Day 31\nAssumed again.\n')

    const report = diagnose(tmpDir)
    expect(report.daysSpan).toBe(31)
  })

  it('returns daysSpan 0 when no dated file names', () => {
    writeFile(tmpDir, 'MEMORY.md', 'I assumed twice.\nAssumed again.\n')
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

  it('sums matches from all patterns', () => {
    writeFile(tmpDir, 'MEMORY.md', [
      '# Memory',
      'I assumed the port was 3000.',
      'Turned out I was wrong.',
      'Forgot to update the docs.',
      'Config was out of sync.',
    ].join('\n'))

    const report = diagnose(tmpDir)
    // All keyword matches across all patterns
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

  it('shows scan summary when patterns exist', () => {
    const report = {
      filesScanned: 5,
      daysSpan: 14,
      totalErrorEvents: 20,
      patterns: [
        {
          id: 'unverified',
          title: 'Acting on Unverified Assumptions',
          count: 8,
          examples: ['I assumed the config was correct.', 'Turned out the port was wrong.'],
          reflection: 'Always verify before acting.',
        },
      ],
    }
    const output = formatDiagnosis(report)
    expect(output).toContain('Scanned: 5 files across 14 days')
    expect(output).toContain('20 error events')
    expect(output).toContain('1 recurring pattern')
    expect(output).toContain('Acting on Unverified Assumptions')
    expect(output).toContain('(8 times)')
    expect(output).toContain('I assumed the config was correct.')
    expect(output).toContain('reflection/mistakes.md')
  })

  it('numbers patterns starting from #1', () => {
    const report = {
      filesScanned: 2,
      daysSpan: 5,
      totalErrorEvents: 10,
      patterns: [
        { id: 'unverified', title: 'Pattern A', count: 6, examples: ['ex1'], reflection: 'Rule A.' },
        { id: 'incomplete', title: 'Pattern B', count: 4, examples: ['ex2'], reflection: 'Rule B.' },
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
        { id: 'unverified', title: 'Test Pattern', count: 3, examples: [], reflection: 'Test rule.' },
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
        { id: 'incomplete', title: 'New Pattern', count: 2, examples: [], reflection: 'New rule.' },
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
        { id: 'unverified', title: 'Pattern One', count: 7, examples: [], reflection: 'Rule one.' },
        { id: 'incomplete', title: 'Pattern Two', count: 5, examples: [], reflection: 'Rule two.' },
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
      'I assumed the endpoint was correct.',
      'Turned out the path was wrong.',
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
      'I assumed the server was running.',
      'Turned out it was stopped.',
      'Another assumption error.',
    ].join('\n'), 'utf8')

    const report = diagnose(tmpDir)
    expect(report.filesScanned).toBe(1)
    const unverified = report.patterns.find(p => p.id === 'unverified')
    expect(unverified).toBeDefined()
  })
})
