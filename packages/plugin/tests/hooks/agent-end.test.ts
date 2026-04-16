import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../../src/db.js'
import type { Db } from '../../src/db.js'
import { createAgentEndHook } from '../../src/hooks/agent-end.js'
import { toolCallBuffers, resetState } from '../../src/hooks/state.js'
import type { ToolCallRecord } from '../../src/extraction-engine.js'

describe('agent_end hook', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
    resetState()
  })

  afterEach(() => {
    db.close()
    resetState()
  })

  it('extracts and stores a lesson from error→fix→success pattern', () => {
    const hook = createAgentEndHook(db)

    // Simulate an error → fix → success buffer
    const buffer: ToolCallRecord[] = [
      { toolName: 'exec', params: {}, error: 'TypeError: Cannot read property of undefined in src/hooks/index.ts', durationMs: 100 },
      { toolName: 'read', params: { path: 'index.ts' }, result: 'file content', durationMs: 5 },
      { toolName: 'edit', params: { path: 'index.ts' }, result: 'edited', durationMs: 20 },
      { toolName: 'exec', params: {}, result: 'All tests passed ✓', durationMs: 200 },
    ]
    toolCallBuffers.set('sess-1', buffer)

    hook(
      { messages: [], success: true },
      { sessionKey: 'sess-1' },
    )

    const lessons = db.listLessons()
    expect(lessons.length).toBe(1)
    expect(lessons[0].what).toContain('TypeError')
    expect(lessons[0].source).toBe('local')
  })

  it('cleans up the buffer after processing', () => {
    const hook = createAgentEndHook(db)

    toolCallBuffers.set('sess-1', [
      { toolName: 'read', params: { path: 'a.ts' }, result: 'content', durationMs: 5 },
      { toolName: 'edit', params: { path: 'a.ts' }, result: 'ok', durationMs: 10 },
    ])

    hook(
      { messages: [], success: true },
      { sessionKey: 'sess-1' },
    )

    expect(toolCallBuffers.has('sess-1')).toBe(false)
  })

  it('does nothing when buffer has fewer than 2 records', () => {
    const hook = createAgentEndHook(db)

    toolCallBuffers.set('sess-1', [
      { toolName: 'read', params: { path: 'a.ts' }, result: 'content', durationMs: 5 },
    ])

    hook(
      { messages: [], success: true },
      { sessionKey: 'sess-1' },
    )

    expect(db.listLessons()).toHaveLength(0)
    // Buffer still cleaned up
    expect(toolCallBuffers.has('sess-1')).toBe(false)
  })

  it('does nothing when no buffer exists', () => {
    const hook = createAgentEndHook(db)

    hook(
      { messages: [], success: false, error: 'something went wrong' },
      { sessionKey: 'sess-99' },
    )

    expect(db.listLessons()).toHaveLength(0)
  })

  it('does not store lesson if extraction returns null (no pattern match)', () => {
    const hook = createAgentEndHook(db)

    // Two reads — no error→fix→success or read→edit→test pattern
    toolCallBuffers.set('sess-1', [
      { toolName: 'read', params: { path: 'a.ts' }, result: 'content', durationMs: 5 },
      { toolName: 'read', params: { path: 'b.ts' }, result: 'content', durationMs: 5 },
    ])

    hook(
      { messages: [], success: true },
      { sessionKey: 'sess-1' },
    )

    expect(db.listLessons()).toHaveLength(0)
  })

  it('never throws even if db.insertLesson throws', () => {
    const brokenDb = {
      ...db,
      insertLesson: () => { throw new Error('DB write failed') },
    } as unknown as Db

    const hook = createAgentEndHook(brokenDb)

    toolCallBuffers.set('sess-1', [
      { toolName: 'exec', params: {}, error: 'TypeError: x is not a function in src/app.ts', durationMs: 100 },
      { toolName: 'edit', params: { path: 'app.ts' }, result: 'fixed', durationMs: 20 },
      { toolName: 'exec', params: {}, result: 'All tests passed ✓', durationMs: 200 },
    ])

    expect(() => {
      hook(
        { messages: [], success: true },
        { sessionKey: 'sess-1' },
      )
    }).not.toThrow()
  })

  it('falls back to "unknown" when sessionKey is absent', () => {
    const hook = createAgentEndHook(db)

    toolCallBuffers.set('unknown', [
      { toolName: 'exec', params: {}, error: 'TypeError: fail in src/test.ts', durationMs: 50 },
      { toolName: 'exec', params: {}, result: 'All tests passed ✓', durationMs: 100 },
    ])

    hook(
      { messages: [], success: true },
      {},
    )

    expect(toolCallBuffers.has('unknown')).toBe(false)
  })
})
