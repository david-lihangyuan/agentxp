import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createDb } from '../src/db.js'
import type { Db } from '../src/db.js'
import { cliStatus, cliDiagnose, cliDistill, cliExport, createCliRegistrar } from '../src/cli.js'
import { DEFAULT_CONFIG } from '../src/types.js'

// ─── Helpers ───────────────────────────────────────────────────────────────

function insertSampleLesson(db: Db, overrides: Partial<{ what: string; tried: string; outcome: string; learned: string; tags: string[]; source: string }> = {}) {
  return db.insertLesson({
    what: overrides.what ?? 'test scenario',
    tried: overrides.tried ?? 'tried this',
    outcome: overrides.outcome ?? 'it worked',
    learned: overrides.learned ?? 'learned that',
    source: overrides.source ?? 'local',
    tags: overrides.tags ?? ['test'],
  })
}

// ─── cliStatus ─────────────────────────────────────────────────────────────

describe('cliStatus', () => {
  let db: Db

  beforeEach(() => { db = createDb() })
  afterEach(() => { db.close() })

  it('includes lesson count', async () => {
    insertSampleLesson(db)
    insertSampleLesson(db)
    const output = await cliStatus(db)
    expect(output).toContain('Lessons (active): 2')
  })

  it('includes FTS5 status', async () => {
    const output = await cliStatus(db)
    expect(output).toMatch(/FTS5: (enabled|unavailable)/)
  })

  it('includes table row counts', async () => {
    const output = await cliStatus(db)
    expect(output).toContain('local_lessons:')
    expect(output).toContain('trace_steps:')
    expect(output).toContain('feedback:')
    expect(output).toContain('injection_log:')
  })

  it('includes injection stats', async () => {
    db.insertInjectionLog({ sessionId: 'sess1', injected: true, tokenCount: 100, lessonIds: [1] })
    const output = await cliStatus(db)
    expect(output).toContain('Injected: 1')
    expect(output).toContain('Total sessions: 1')
  })

  it('shows trace step count', async () => {
    db.insertTraceStep({ sessionId: 's1', action: 'read', toolName: 'read', timestamp: Date.now() })
    const output = await cliStatus(db)
    expect(output).toContain('Trace steps: 1')
  })
})

// ─── cliDiagnose ───────────────────────────────────────────────────────────

describe('cliDiagnose', () => {
  let db: Db
  let tmpDir: string

  beforeEach(() => {
    db = createDb()
    tmpDir = join(tmpdir(), `agentxp-diag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(tmpDir, 'memory'), { recursive: true })
  })

  afterEach(() => {
    db.close()
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('returns "no files" when workspace is empty', async () => {
    const emptyDir = join(tmpDir, 'empty')
    mkdirSync(emptyDir, { recursive: true })
    const output = await cliDiagnose(db, emptyDir)
    expect(output).toContain('No memory files found')
  })

  it('detects unverified assumption pattern', async () => {
    writeFileSync(join(tmpDir, 'memory', '2024-01-01.md'), [
      '## Error: wrong port',
      'I answered without checking the config and it failed.',
      '',
      '## Another bug fix',
      'I didn\'t verify the endpoint and got an error again.',
      '',
      '## Third time',
      'Without verifying the result, the deployment broke.',
    ].join('\n'))
    const output = await cliDiagnose(db, tmpDir)
    expect(output).toContain('Acting on Unverified Assumptions')
    expect(output).toContain('verify before acting')
  })

  it('detects incomplete work pattern', async () => {
    writeFileSync(join(tmpDir, 'memory', '2024-01-01.md'), [
      '## Fix deployment',
      '[!] wrote code but never tested it in production',
      'implemented but forgot to wire up the handler',
      '',
      '## Tests',
      'tests pass but the feature is not synced',
    ].join('\n'))
    const output = await cliDiagnose(db, tmpDir)
    expect(output).toContain('Marking Work Done Before Complete')
  })

  it('detects symptom-fix pattern', async () => {
    writeFileSync(join(tmpDir, 'memory', '2024-01-01.md'), [
      'same bug appeared again',
      'same error in another module',
      '又一次出现同样的问题',
    ].join('\n'))
    const output = await cliDiagnose(db, tmpDir)
    expect(output).toContain('Fixing Symptoms Instead of Root Causes')
  })

  it('reports files scanned and days span', async () => {
    writeFileSync(join(tmpDir, 'memory', '2024-01-01.md'), 'same bug\nsame error\n')
    writeFileSync(join(tmpDir, 'memory', '2024-01-10.md'), 'same issue\n又一次\n')
    const output = await cliDiagnose(db, tmpDir)
    expect(output).toContain('Files scanned: 2')
    expect(output).toContain('Days span: 10')
  })

  it('shows no patterns when threshold not met', async () => {
    writeFileSync(join(tmpDir, 'memory', '2024-01-01.md'), 'everything is fine\n')
    const output = await cliDiagnose(db, tmpDir)
    expect(output).toContain('No recurring error patterns detected')
  })

  it('excludes design/spec files', async () => {
    writeFileSync(join(tmpDir, 'memory', 'design-doc.md'), 'same bug\nsame error\nsame issue\n')
    const output = await cliDiagnose(db, tmpDir)
    expect(output).toContain('No memory files found')
  })
})

// ─── cliDistill ────────────────────────────────────────────────────────────

describe('cliDistill', () => {
  let db: Db

  beforeEach(() => { db = createDb() })
  afterEach(() => { db.close() })

  it('returns message when no groups ready', async () => {
    insertSampleLesson(db, { tags: ['a'] })
    const output = await cliDistill(db)
    expect(output).toContain('No lesson groups ready')
  })

  it('merges lessons when 5+ share a tag', async () => {
    for (let i = 0; i < 6; i++) {
      insertSampleLesson(db, {
        what: `scenario ${i}`,
        learned: `insight ${i}`,
        tags: ['deploy'],
      })
    }
    const output = await cliDistill(db)
    expect(output).toContain('Merged 6 lessons for tag "deploy"')
    expect(output).toContain('1 group(s) distilled')

    // Verify originals are outdated and merged lesson exists
    const all = db.listAllLessons()
    const strategy = all.find(l => l.what.startsWith('[strategy]'))
    expect(strategy).toBeDefined()
    expect(strategy!.what).toContain('deploy')
  })

  it('deduplicates learned text in merged lesson', async () => {
    for (let i = 0; i < 5; i++) {
      insertSampleLesson(db, {
        what: `scenario ${i}`,
        learned: 'same insight',
        tags: ['dup'],
      })
    }
    await cliDistill(db)
    const all = db.listAllLessons()
    const strategy = all.find(l => l.what.startsWith('[strategy]'))
    expect(strategy).toBeDefined()
    // Should only have "same insight" once, not 5 times
    expect(strategy!.learned).toBe('same insight')
  })
})

// ─── cliExport ─────────────────────────────────────────────────────────────

describe('cliExport', () => {
  let db: Db

  beforeEach(() => { db = createDb() })
  afterEach(() => { db.close() })

  it('exports empty JSON array when no lessons', async () => {
    const output = await cliExport(db, 'json')
    expect(output).toBe('[]')
  })

  it('exports empty string for JSONL when no lessons', async () => {
    const output = await cliExport(db, 'jsonl')
    expect(output).toBe('')
  })

  it('exports valid JSON', async () => {
    insertSampleLesson(db, { what: 'lesson 1' })
    insertSampleLesson(db, { what: 'lesson 2' })
    const output = await cliExport(db, 'json')
    const parsed = JSON.parse(output)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].what).toBeDefined()
  })

  it('exports valid JSONL (one JSON per line)', async () => {
    insertSampleLesson(db, { what: 'lesson A' })
    insertSampleLesson(db, { what: 'lesson B' })
    const output = await cliExport(db, 'jsonl')
    const lines = output.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      const parsed = JSON.parse(line)
      expect(parsed.what).toBeDefined()
    }
  })

  it('includes outdated lessons in export', async () => {
    const id = insertSampleLesson(db, { what: 'old lesson' })
    db.markOutdated(id)
    insertSampleLesson(db, { what: 'active lesson' })
    const output = await cliExport(db, 'json')
    const parsed = JSON.parse(output)
    expect(parsed).toHaveLength(2) // listAllLessons includes outdated
  })

  it('defaults to json format', async () => {
    insertSampleLesson(db)
    const output = await cliExport(db)
    expect(() => JSON.parse(output)).not.toThrow()
    expect(Array.isArray(JSON.parse(output))).toBe(true)
  })
})

// ─── createCliRegistrar ────────────────────────────────────────────────────

describe('createCliRegistrar', () => {
  it('returns a function', () => {
    const db = createDb()
    const registrar = createCliRegistrar(db, DEFAULT_CONFIG)
    expect(typeof registrar).toBe('function')
    db.close()
  })

  it('registers agentxp command with subcommands', () => {
    const db = createDb()
    const registrar = createCliRegistrar(db, DEFAULT_CONFIG)

    // Mock commander-like API
    const commands: Record<string, any> = {}
    const mockProgram = {
      command(name: string) {
        const cmd: any = {
          _name: name,
          _description: '',
          _commands: {} as Record<string, any>,
          description(d: string) { cmd._description = d; return cmd },
          command(sub: string) {
            const subCmd: any = {
              _name: sub,
              _description: '',
              _options: [] as string[],
              description(d: string) { subCmd._description = d; return subCmd },
              option(flags: string, desc: string, defaultVal?: string) {
                subCmd._options.push(flags)
                return subCmd
              },
              action(_fn: any) { return subCmd },
            }
            cmd._commands[sub] = subCmd
            return subCmd
          },
        }
        commands[name] = cmd
        return cmd
      },
    }

    registrar({ program: mockProgram })

    expect(commands['agentxp']).toBeDefined()
    expect(commands['agentxp']._commands['status']).toBeDefined()
    expect(commands['agentxp']._commands['diagnose']).toBeDefined()
    expect(commands['agentxp']._commands['distill']).toBeDefined()
    expect(commands['agentxp']._commands['export']).toBeDefined()

    db.close()
  })
})
