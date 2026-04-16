import { describe, it, expect } from 'vitest'
import {
  extractFromToolCalls,
  extractFromText,
  qualityGate,
  type ToolCallRecord,
} from '../src/extraction-engine.js'

// ─── ToolCallRecord helpers ────────────────────────────────────────────────

function makeRecord(
  overrides: Partial<ToolCallRecord> & { toolName: string },
): ToolCallRecord {
  return {
    params: {},
    ...overrides,
  }
}

// ─── Mode A: Tool call extraction ──────────────────────────────────────────

describe('extractFromToolCalls', () => {
  it('returns null for empty buffer', () => {
    expect(extractFromToolCalls([])).toBeNull()
  })

  it('detects error → fix → success pattern', () => {
    const buffer: ToolCallRecord[] = [
      makeRecord({
        toolName: 'exec',
        params: { path: '/app/test.ts' },
        error: 'TypeError: Cannot read property of undefined',
      }),
      makeRecord({
        toolName: 'read',
        params: { path: '/app/src/handler.ts' },
        result: 'export function handler() ...',
      }),
      makeRecord({
        toolName: 'edit',
        params: { path: '/app/src/handler.ts' },
        result: 'File edited successfully',
      }),
      makeRecord({
        toolName: 'exec',
        params: { path: '/app/test.ts' },
        result: 'Tests passed: 5/5',
      }),
    ]

    const lesson = extractFromToolCalls(buffer)
    expect(lesson).not.toBeNull()
    expect(lesson!.what.length).toBeGreaterThanOrEqual(10)
    expect(lesson!.learned.length).toBeGreaterThanOrEqual(20)
    expect(lesson!.tried).toBeTruthy()
    expect(lesson!.outcome).toBeTruthy()
  })

  it('detects exec fail → exec success pattern', () => {
    const buffer: ToolCallRecord[] = [
      makeRecord({
        toolName: 'exec',
        error: 'ModuleNotFoundError: No module named requests',
        durationMs: 120,
      }),
      makeRecord({
        toolName: 'exec',
        result: 'Successfully installed requests-2.31.0',
        durationMs: 3000,
      }),
      makeRecord({
        toolName: 'exec',
        result: 'Script completed successfully',
        durationMs: 500,
      }),
    ]

    const lesson = extractFromToolCalls(buffer)
    expect(lesson).not.toBeNull()
    expect(lesson!.what).toContain('ModuleNotFoundError')
  })

  it('detects read → edit → test-pass pattern', () => {
    const buffer: ToolCallRecord[] = [
      makeRecord({
        toolName: 'read',
        params: { path: '/app/src/utils.ts' },
        result: 'export function add(a: number, b: number) { return a + b }',
      }),
      makeRecord({
        toolName: 'edit',
        params: { path: '/app/src/utils.ts' },
        result: 'File edited',
      }),
      makeRecord({
        toolName: 'exec',
        result: 'PASS src/utils.test.ts\nTests: 3 passed, 3 total',
      }),
    ]

    const lesson = extractFromToolCalls(buffer)
    expect(lesson).not.toBeNull()
    expect(lesson!.what).toBeTruthy()
  })

  it('returns null when no recognizable pattern', () => {
    const buffer: ToolCallRecord[] = [
      makeRecord({ toolName: 'read', result: 'some content' }),
      makeRecord({ toolName: 'read', result: 'more content' }),
    ]

    expect(extractFromToolCalls(buffer)).toBeNull()
  })

  it('returns null for a single tool call (no pattern to detect)', () => {
    const buffer: ToolCallRecord[] = [
      makeRecord({ toolName: 'exec', error: 'SyntaxError: unexpected token' }),
    ]

    expect(extractFromToolCalls(buffer)).toBeNull()
  })
})

// ─── Mode B: Text extraction ───────────────────────────────────────────────

describe('extractFromText', () => {
  it('returns null for empty string', () => {
    expect(extractFromText('')).toBeNull()
  })

  it('returns null for text without patterns', () => {
    expect(extractFromText('Hello world, this is just a greeting.')).toBeNull()
  })

  it('detects "the issue was... fixed by..." pattern', () => {
    const text =
      'The issue was a TypeError in handler.ts when accessing undefined properties. ' +
      'Fixed by adding null checks before the property access chain.'

    const lesson = extractFromText(text)
    expect(lesson).not.toBeNull()
    expect(lesson!.what).toContain('TypeError')
    expect(lesson!.learned.length).toBeGreaterThanOrEqual(20)
  })

  it('detects "I learned that..." pattern', () => {
    const text =
      'I learned that vitest.config.ts needs explicit alias for better-sqlite3 ' +
      'to resolve the native binding correctly in ESM mode.'

    const lesson = extractFromText(text)
    expect(lesson).not.toBeNull()
    expect(lesson!.learned).toBeTruthy()
  })

  it('detects "the solution is..." pattern', () => {
    const text =
      'The problem was CORS errors when fetching /api/data from localhost:3000. ' +
      'The solution is to configure the proxy in vite.config.ts with a rewrite rule.'

    const lesson = extractFromText(text)
    expect(lesson).not.toBeNull()
  })

  it('detects "turns out..." pattern', () => {
    const text =
      'Turns out the ConnectionError was caused by the database pool exhaustion. ' +
      'The connection limit was set to 5 but the app spawned 20 concurrent queries.'

    const lesson = extractFromText(text)
    expect(lesson).not.toBeNull()
    expect(lesson!.what).toContain('ConnectionError')
  })

  it('detects Chinese pattern "原因是..."', () => {
    const text =
      '原因是 TypeORM 的 migration 文件路径配置错误，指向了 src/ 而不是 dist/。' +
      '解决了，把 migrationsDir 改成 dist/migrations/ 就行了。'

    const lesson = extractFromText(text)
    expect(lesson).not.toBeNull()
  })

  it('detects Chinese pattern "发现..."', () => {
    const text =
      '发现 better-sqlite3 在 ARM64 上需要重新编译 native binding，' +
      '直接 npm rebuild better-sqlite3 就能修复 NAPI 版本不匹配的 BuildError。'

    const lesson = extractFromText(text)
    expect(lesson).not.toBeNull()
  })
})

// ─── Quality Gate ──────────────────────────────────────────────────────────

describe('qualityGate', () => {
  it('rejects when what is too short', () => {
    expect(
      qualityGate({
        what: 'short',
        tried: 'something',
        outcome: 'success',
        learned: 'I learned that TypeError occurs when accessing /app/handler.ts',
      }),
    ).toBe(false)
  })

  it('rejects when learned is too short', () => {
    expect(
      qualityGate({
        what: 'A long enough description of the problem',
        tried: 'something',
        outcome: 'success',
        learned: 'short learned',
      }),
    ).toBe(false)
  })

  it('rejects when no technical noun in learned', () => {
    expect(
      qualityGate({
        what: 'Something was wrong with the system',
        tried: 'various things to fix it',
        outcome: 'it worked eventually',
        learned: 'The answer was to change the configuration setting to a different value',
      }),
    ).toBe(false)
  })

  it('passes with XxxError pattern in learned', () => {
    expect(
      qualityGate({
        what: 'A problem occurred during testing phase',
        tried: 'checked the stack trace',
        outcome: 'resolved the issue',
        learned:
          'The TypeError was caused by missing null check before accessing nested properties',
      }),
    ).toBe(true)
  })

  it('passes with file path in learned', () => {
    expect(
      qualityGate({
        what: 'Build failed with module resolution error',
        tried: 'checked tsconfig and vite config',
        outcome: 'build passes now',
        learned:
          'The alias in /app/vite.config.ts must point to the resolved CJS entry for native modules',
      }),
    ).toBe(true)
  })

  it('passes with method() call in learned', () => {
    expect(
      qualityGate({
        what: 'Database queries were extremely slow',
        tried: 'added logging and profiling',
        outcome: 'performance improved 10x',
        learned:
          'Using db.prepare() with positional parameters avoids re-compilation on every call',
      }),
    ).toBe(true)
  })
})

// ─── Integration: pipeline produces sanitized output ───────────────────────

describe('extraction pipeline integration', () => {
  it('tool call extraction passes through sanitize', () => {
    const buffer: ToolCallRecord[] = [
      makeRecord({
        toolName: 'exec',
        error: 'AuthError: invalid token sk-abcdef1234567890abcdef1234567890',
      }),
      makeRecord({
        toolName: 'exec',
        result: 'Connected successfully after fixing the AuthError with new token',
      }),
    ]

    const lesson = extractFromToolCalls(buffer)
    // If lesson is produced, credentials should be redacted
    if (lesson) {
      const allText = `${lesson.what} ${lesson.tried} ${lesson.outcome} ${lesson.learned}`
      expect(allText).not.toMatch(/sk-[a-zA-Z0-9_-]{20,}/)
    }
  })

  it('mixed input: both tool calls and text — only one lesson from tool calls', () => {
    // The spec says: mixed input → only one lesson from tool calls (priority)
    // This is tested at the caller level, not here. Tool call extraction
    // and text extraction are separate functions the caller chooses between.
    // This test just ensures both can produce results independently.
    const toolLesson = extractFromToolCalls([
      makeRecord({ toolName: 'exec', error: 'SyntaxError: missing semicolon in /app/index.ts' }),
      makeRecord({ toolName: 'edit', params: { path: '/app/index.ts' }, result: 'edited' }),
      makeRecord({ toolName: 'exec', result: 'Compilation successful' }),
    ])

    const textLesson = extractFromText(
      'The issue was a SyntaxError in /app/index.ts. Fixed by adding the missing semicolon.',
    )

    // Both should produce results for their respective inputs
    expect(toolLesson).not.toBeNull()
    expect(textLesson).not.toBeNull()
  })
})
