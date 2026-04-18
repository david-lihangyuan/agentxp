// trace-recorder.test.ts — L2 轨迹系统单元测试
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { TraceRecorder } from '../src/trace-recorder.js'
import type { TraceAction } from '../src/trace-recorder.js'

// ─── 辅助 ─────────────────────────────────────────────────────────────────

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), 'trace-recorder-test-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ─── 1. 构造函数 + addStep ──────────────────────────────────────────────────

describe('constructor + addStep', () => {
  it('creates a new recorder with contextAtStart', () => {
    const r = new TraceRecorder('fix bug in login flow')
    const ex = r.export()
    expect(ex.steps).toHaveLength(0)
    expect(ex.dead_ends).toHaveLength(0)
    expect(ex.confidence).toBeNull()
  })

  it('addStep records a step with defaults', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'read the error log')
    const ex = r.export()
    expect(ex.steps).toHaveLength(1)
    expect(ex.steps[0].action).toBe('observe')
    expect(ex.steps[0].content).toBe('read the error log')
    expect(ex.steps[0].significance).toBe('routine')
    expect(ex.steps[0].timestamp).toBeGreaterThan(0)
  })

  it('addStep accepts significance override', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('decide', 'use plan A', { significance: 'key' })
    expect(r.export().steps[0].significance).toBe('key')
  })

  it('addStep accepts action_raw', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('investigate', 'checked source code', { action_raw: '查了源码' })
    expect(r.export().steps[0].action_raw).toBe('查了源码')
  })

  it('addStep accepts references', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'saw the config', { references: ['config.json', 'README.md'] })
    expect(r.export().steps[0].references).toEqual(['config.json', 'README.md'])
  })

  it('addStep omits action_raw when not provided', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'plain observation')
    const step = r.export().steps[0]
    expect(step.action_raw).toBeUndefined()
  })

  it('addStep omits references when not provided', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'plain observation')
    const step = r.export().steps[0]
    expect(step.references).toBeUndefined()
  })

  it('multiple addStep calls accumulate in order', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'step 1')
    r.addStep('hypothesize', 'step 2')
    r.addStep('investigate', 'step 3')
    r.addStep('conclude', 'step 4')
    const steps = r.export().steps
    expect(steps).toHaveLength(4)
    expect(steps.map(s => s.action)).toEqual(['observe', 'hypothesize', 'investigate', 'conclude'])
  })
})

// ─── 2. addDeadEnd ──────────────────────────────────────────────────────────

describe('addDeadEnd', () => {
  it('records a dead end with current step_index', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('investigate', 'tried approach A')
    r.addDeadEnd('approach A', 'did not compile')
    const ex = r.export()
    expect(ex.dead_ends).toHaveLength(1)
    expect(ex.dead_ends[0].tried).toBe('approach A')
    expect(ex.dead_ends[0].why_abandoned).toBe('did not compile')
    expect(ex.dead_ends[0].step_index).toBe(0)
  })

  it('multiple dead ends accumulate', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('investigate', 'A')
    r.addDeadEnd('A', 'reason A')
    r.addStep('investigate', 'B')
    r.addDeadEnd('B', 'reason B')
    expect(r.export().dead_ends).toHaveLength(2)
  })

  it('dead end step_index updates correctly', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 's0')
    r.addStep('investigate', 's1')
    r.addDeadEnd('tried x', 'why x')
    expect(r.export().dead_ends[0].step_index).toBe(1)
  })
})

// ─── 3. backtrack ───────────────────────────────────────────────────────────

describe('backtrack', () => {
  it('auto-adds a backtrack step with key significance', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('investigate', 'probing')
    r.backtrack('this path is wrong')
    const steps = r.export().steps
    expect(steps).toHaveLength(2)
    expect(steps[1].action).toBe('backtrack')
    expect(steps[1].significance).toBe('key')
    expect(steps[1].content).toBe('this path is wrong')
  })

  it('multiple backtracks are all recorded', () => {
    const r = new TraceRecorder('ctx')
    r.backtrack('reason 1')
    r.backtrack('reason 2')
    const steps = r.export().steps
    expect(steps.filter(s => s.action === 'backtrack')).toHaveLength(2)
  })
})

// ─── 4. normalizeAction ─────────────────────────────────────────────────────

describe('normalizeAction', () => {
  const cases: [string, TraceAction][] = [
    // 中文 → investigate
    ['查源码', 'investigate'],
    ['查了源码', 'investigate'],
    ['调查问题', 'investigate'],
    ['分析日志', 'investigate'],
    // 中文 → decide
    ['决定用方案A', 'decide'],
    ['选择了新方案', 'decide'],
    ['确定方案', 'decide'],
    // 中文 → verify
    ['验证结果', 'verify'],
    ['测试通过', 'verify'],
    ['确认了问题', 'verify'],
    // 中文 → backtrack
    ['回退到上一步', 'backtrack'],
    ['撤销更改', 'backtrack'],
    // 中文 → observe
    ['读文件', 'observe'],
    ['查看日志', 'observe'],
    ['看到了错误', 'observe'],
    // 中文 → conclude
    ['得出结论', 'conclude'],
    ['完成任务', 'conclude'],
    // 英文
    ['read the config file', 'observe'],
    ['investigate the bug', 'investigate'],
    ['decide to use postgres', 'decide'],
    ['verify the output', 'verify'],
    ['backtrack and retry', 'backtrack'],
    ['conclude: fix works', 'conclude'],
  ]

  for (const [input, expectedAction] of cases) {
    it(`"${input}" → ${expectedAction}`, () => {
      const result = TraceRecorder.normalizeAction(input)
      expect(result.action).toBe(expectedAction)
    })
  }

  it('stores action_raw when input is not the enum name itself', () => {
    const result = TraceRecorder.normalizeAction('查源码')
    expect(result.action_raw).toBe('查源码')
  })

  it('falls back to investigate with action_raw for unknown input', () => {
    const result = TraceRecorder.normalizeAction('做了一些奇怪的事情XYZ')
    expect(result.action).toBe('investigate')
    expect(result.action_raw).toBe('做了一些奇怪的事情XYZ')
  })

  it('exact enum name does not store action_raw', () => {
    const result = TraceRecorder.normalizeAction('observe')
    expect(result.action).toBe('observe')
    expect(result.action_raw).toBeUndefined()
  })
})

// ─── 5. assessWorthiness ────────────────────────────────────────────────────

describe('assessWorthiness', () => {
  it('low when steps < 3', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 's1')
    r.addStep('decide', 's2')
    expect(r.assessWorthiness()).toBe('low')
  })

  it('low when steps == 3 but no dead_ends, no backtrack, steps < 8', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 's1')
    r.addStep('investigate', 's2')
    r.addStep('decide', 's3')
    expect(r.assessWorthiness()).toBe('low')
  })

  it('high when steps >= 3 and has dead_ends', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 's1')
    r.addStep('investigate', 's2')
    r.addStep('decide', 's3')
    r.addDeadEnd('tried X', 'failed')
    expect(r.assessWorthiness()).toBe('high')
  })

  it('high when steps >= 3 and has backtrack', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 's1')
    r.addStep('investigate', 's2')
    r.backtrack('wrong path')  // this makes it 3 steps total
    expect(r.assessWorthiness()).toBe('high')
  })

  it('high when steps >= 8', () => {
    const r = new TraceRecorder('ctx')
    for (let i = 0; i < 8; i++) r.addStep('observe', `s${i}`)
    expect(r.assessWorthiness()).toBe('high')
  })

  it('low when steps == 0', () => {
    const r = new TraceRecorder('ctx')
    expect(r.assessWorthiness()).toBe('low')
  })
})

// ─── 6. computeDifficulty ───────────────────────────────────────────────────

describe('computeDifficulty', () => {
  it('trivial: 0 steps, 0 dead_ends', () => {
    const r = new TraceRecorder('ctx')
    const d = r.computeDifficulty()
    expect(d.computed).toBe('trivial')
    expect(d.steps_count).toBe(0)
    expect(d.dead_ends_count).toBe(0)
  })

  it('trivial: 2 steps, 0 dead_ends', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'a')
    r.addStep('decide', 'b')
    expect(r.computeDifficulty().computed).toBe('trivial')
  })

  it('easy: 3 steps, 0 dead_ends', () => {
    const r = new TraceRecorder('ctx')
    for (let i = 0; i < 3; i++) r.addStep('observe', `s${i}`)
    expect(r.computeDifficulty().computed).toBe('easy')
  })

  it('easy: 5 steps, 0 dead_ends', () => {
    const r = new TraceRecorder('ctx')
    for (let i = 0; i < 5; i++) r.addStep('observe', `s${i}`)
    expect(r.computeDifficulty().computed).toBe('easy')
  })

  it('medium: 6 steps, 0 dead_ends', () => {
    const r = new TraceRecorder('ctx')
    for (let i = 0; i < 6; i++) r.addStep('observe', `s${i}`)
    expect(r.computeDifficulty().computed).toBe('medium')
  })

  it('medium: 10 steps, 1 dead_end', () => {
    const r = new TraceRecorder('ctx')
    for (let i = 0; i < 10; i++) r.addStep('observe', `s${i}`)
    r.addDeadEnd('t', 'w')
    expect(r.computeDifficulty().computed).toBe('medium')
  })

  it('hard: 11 steps, 0 dead_ends', () => {
    const r = new TraceRecorder('ctx')
    for (let i = 0; i < 11; i++) r.addStep('observe', `s${i}`)
    expect(r.computeDifficulty().computed).toBe('hard')
  })

  it('expert: 21 steps, 4 dead_ends', () => {
    const r = new TraceRecorder('ctx')
    for (let i = 0; i < 21; i++) r.addStep('observe', `s${i}`)
    for (let i = 0; i < 4; i++) r.addDeadEnd(`t${i}`, `w${i}`)
    expect(r.computeDifficulty().computed).toBe('expert')
  })

  it('returns correct counts', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'a')
    r.addStep('decide', 'b')
    r.addStep('conclude', 'c')
    r.addDeadEnd('x', 'y')
    const d = r.computeDifficulty()
    expect(d.steps_count).toBe(3)
    expect(d.dead_ends_count).toBe(1)
  })
})

// ─── 7. generateSummary ─────────────────────────────────────────────────────

describe('generateSummary', () => {
  it('returns placeholder for empty recorder', () => {
    const r = new TraceRecorder('ctx')
    expect(r.generateSummary()).toBe('（无步骤）')
  })

  it('contains all action names joined by →', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'o1')
    r.addStep('investigate', 'i1')
    r.addStep('conclude', 'done')
    const s = r.generateSummary()
    expect(s).toContain('observe → investigate → conclude')
  })

  it('includes key step content after 关键转折', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'saw the error', { significance: 'key' })
    r.addStep('conclude', 'fixed it')
    const s = r.generateSummary()
    expect(s).toContain('关键转折：saw the error')
  })

  it('omits 关键转折 when no key steps', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'routine observation')
    r.addStep('conclude', 'done')
    expect(r.generateSummary()).not.toContain('关键转折')
  })

  it('includes multiple key steps separated by ；', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'key obs', { significance: 'key' })
    r.addStep('decide', 'key decision', { significance: 'key' })
    r.addStep('conclude', 'done')
    const s = r.generateSummary()
    expect(s).toContain('key obs；key decision')
  })
})

// ─── 8. export ──────────────────────────────────────────────────────────────

describe('export', () => {
  it('returns complete structure with all required fields', () => {
    const r = new TraceRecorder('ctx')
    const ex = r.export()
    expect(ex).toHaveProperty('steps')
    expect(ex).toHaveProperty('dead_ends')
    expect(ex).toHaveProperty('trace_summary')
    expect(ex).toHaveProperty('confidence')
    expect(ex).toHaveProperty('duration_seconds')
    expect(ex).toHaveProperty('trace_worthiness')
    expect(ex).toHaveProperty('computed_difficulty')
  })

  it('export does not mutate internal state (steps is a copy)', () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'a')
    const ex = r.export()
    ex.steps.push({ action: 'conclude', content: 'injected', significance: 'key', timestamp: 0 })
    expect(r.export().steps).toHaveLength(1)
  })

  it('duration_seconds is non-negative', () => {
    const r = new TraceRecorder('ctx')
    expect(r.export().duration_seconds).toBeGreaterThanOrEqual(0)
  })

  it('confidence is null initially', () => {
    const r = new TraceRecorder('ctx')
    expect(r.export().confidence).toBeNull()
  })

  it('computed_difficulty has all fields', () => {
    const r = new TraceRecorder('ctx')
    const d = r.export().computed_difficulty
    expect(d).toHaveProperty('computed')
    expect(d).toHaveProperty('steps_count')
    expect(d).toHaveProperty('dead_ends_count')
  })
})

// ─── 9. setConfidence ───────────────────────────────────────────────────────

describe('setConfidence', () => {
  it('sets confidence to a valid value', () => {
    const r = new TraceRecorder('ctx')
    r.setConfidence(0.9)
    expect(r.export().confidence).toBe(0.9)
  })

  it('accepts boundary value 0', () => {
    const r = new TraceRecorder('ctx')
    r.setConfidence(0)
    expect(r.export().confidence).toBe(0)
  })

  it('accepts boundary value 1', () => {
    const r = new TraceRecorder('ctx')
    r.setConfidence(1)
    expect(r.export().confidence).toBe(1)
  })

  it('throws RangeError for value < 0', () => {
    const r = new TraceRecorder('ctx')
    expect(() => r.setConfidence(-0.1)).toThrow(RangeError)
  })

  it('throws RangeError for value > 1', () => {
    const r = new TraceRecorder('ctx')
    expect(() => r.setConfidence(1.1)).toThrow(RangeError)
  })
})

// ─── 10. appendToFile + loadFromFile ────────────────────────────────────────

describe('appendToFile + loadFromFile', () => {
  it('writes and restores steps correctly', async () => {
    const r = new TraceRecorder('my task context')
    r.addStep('observe', 'saw config', { significance: 'context', references: ['cfg.json'] })
    r.addStep('investigate', 'dug deeper')
    r.addStep('conclude', 'found it', { significance: 'key' })
    const filepath = join(tmpDir, 'trace.jsonl')
    await r.appendToFile(filepath)

    const restored = TraceRecorder.loadFromFile(filepath)
    const ex = restored.export()
    expect(ex.steps).toHaveLength(3)
    expect(ex.steps[0].action).toBe('observe')
    expect(ex.steps[0].references).toEqual(['cfg.json'])
    expect(ex.steps[2].significance).toBe('key')
  })

  it('restores dead_ends correctly', async () => {
    const r = new TraceRecorder('ctx')
    r.addStep('investigate', 'tried X')
    r.addDeadEnd('approach X', 'threw exceptions')
    const filepath = join(tmpDir, 'trace2.jsonl')
    await r.appendToFile(filepath)

    const restored = TraceRecorder.loadFromFile(filepath)
    expect(restored.export().dead_ends).toHaveLength(1)
    expect(restored.export().dead_ends[0].tried).toBe('approach X')
  })

  it('restores confidence correctly', async () => {
    const r = new TraceRecorder('ctx')
    r.addStep('conclude', 'done')
    r.setConfidence(0.85)
    const filepath = join(tmpDir, 'trace3.jsonl')
    await r.appendToFile(filepath)

    const restored = TraceRecorder.loadFromFile(filepath)
    expect(restored.export().confidence).toBe(0.85)
  })

  it('null confidence is preserved (not written to file)', async () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'a')
    const filepath = join(tmpDir, 'trace4.jsonl')
    await r.appendToFile(filepath)

    const restored = TraceRecorder.loadFromFile(filepath)
    expect(restored.export().confidence).toBeNull()
  })

  it('throws on missing file', () => {
    expect(() => TraceRecorder.loadFromFile(join(tmpDir, 'nonexistent.jsonl'))).toThrow()
  })

  it('calling appendToFile twice overwrites (idempotent)', async () => {
    const r = new TraceRecorder('ctx')
    r.addStep('observe', 'first')
    const filepath = join(tmpDir, 'trace5.jsonl')
    await r.appendToFile(filepath)
    r.addStep('conclude', 'second')
    await r.appendToFile(filepath)

    const restored = TraceRecorder.loadFromFile(filepath)
    expect(restored.export().steps).toHaveLength(2)
  })
})

// ─── 11. 完整流程 ─────────────────────────────────────────────────────────────

describe('complete workflow', () => {
  it('construct → addStep × N → addDeadEnd → backtrack → conclude → export', async () => {
    const r = new TraceRecorder('Fix the login timeout bug in production')

    // Phase 1: observe
    r.addStep('observe', 'noticed 401 errors in Sentry logs', { significance: 'key', references: ['sentry.io/issue/123'] })
    r.addStep('hypothesize', 'JWT might be expiring too quickly')

    // Phase 2: investigate
    r.addStep('investigate', 'read JWT config file', { significance: 'context' })
    r.addStep('investigate', 'checked token TTL = 1h')

    // Phase 3: dead end
    r.addStep('decide', 'try extending TTL to 24h')
    r.addDeadEnd('extend TTL to 24h', 'security team rejected: too long')

    // Phase 4: backtrack
    r.backtrack('TTL extension rejected, need different approach')

    // Phase 5: new direction
    r.addStep('investigate', 'look at refresh token logic')
    r.addStep('observe', 'refresh token endpoint missing CORS header', { significance: 'key' })
    r.addStep('decide', 'add CORS header to refresh endpoint', { significance: 'key' })
    r.addStep('verify', 'deployed fix and tested in staging')

    // Conclude
    r.addStep('conclude', 'CORS header fix resolved login timeouts', { significance: 'key' })
    r.setConfidence(0.95)

    const ex = r.export()

    // Structural checks
    expect(ex.steps.length).toBeGreaterThanOrEqual(11)
    expect(ex.dead_ends).toHaveLength(1)
    expect(ex.confidence).toBe(0.95)
    expect(ex.trace_worthiness).toBe('high')
    expect(ex.computed_difficulty.computed).not.toBe('trivial')

    // Summary should mention backtrack and conclude
    expect(ex.trace_summary).toContain('backtrack')
    expect(ex.trace_summary).toContain('conclude')
    expect(ex.trace_summary).toContain('关键转折')

    // Persist and restore
    const filepath = join(tmpDir, 'full-workflow.jsonl')
    await r.appendToFile(filepath)
    const restored = TraceRecorder.loadFromFile(filepath)
    const rex = restored.export()
    expect(rex.steps.length).toBe(ex.steps.length)
    expect(rex.dead_ends.length).toBe(ex.dead_ends.length)
    expect(rex.confidence).toBe(0.95)
  })
})
