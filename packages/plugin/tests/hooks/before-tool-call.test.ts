import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../../src/db.js'
import type { Db } from '../../src/db.js'
import { createBeforeToolCallHook, normalizeAction } from '../../src/hooks/before-tool-call.js'

describe('normalizeAction', () => {
  it('normalizes known tool names', () => {
    expect(normalizeAction('read')).toBe('file:read')
    expect(normalizeAction('write')).toBe('file:write')
    expect(normalizeAction('edit')).toBe('file:edit')
    expect(normalizeAction('exec')).toBe('shell:exec')
    expect(normalizeAction('process')).toBe('shell:process')
    expect(normalizeAction('web_fetch')).toBe('web:fetch')
    expect(normalizeAction('image')).toBe('media:image')
    expect(normalizeAction('image_generate')).toBe('media:generate')
    expect(normalizeAction('memory_search')).toBe('memory:search')
    expect(normalizeAction('memory_get')).toBe('memory:get')
  })

  it('falls back to tool:name for unknown tools', () => {
    expect(normalizeAction('custom_tool')).toBe('tool:custom_tool')
    expect(normalizeAction('foobar')).toBe('tool:foobar')
  })
})

describe('before_tool_call hook', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('inserts a trace step with normalized action', () => {
    const hook = createBeforeToolCallHook(db)

    hook(
      { toolName: 'read', params: { path: '/secret/path/to/file.ts' } },
      { sessionKey: 'sess-1', toolName: 'read' },
    )

    const steps = db.getTraceSteps('sess-1')
    expect(steps).toHaveLength(1)
    expect(steps[0].action).toBe('file:read')
    expect(steps[0].toolName).toBe('read')
    expect(steps[0].significance).toBe('routine')
  })

  it('does NOT store raw params in trace_steps', () => {
    const hook = createBeforeToolCallHook(db)

    hook(
      { toolName: 'write', params: { path: '/secret/dir/passwords.txt', content: 'super-secret-data' } },
      { sessionKey: 'sess-1', toolName: 'write' },
    )

    const steps = db.getTraceSteps('sess-1')
    expect(steps).toHaveLength(1)
    // The trace step should not contain raw params
    const serialized = JSON.stringify(steps[0])
    expect(serialized).not.toContain('passwords.txt')
    expect(serialized).not.toContain('super-secret')
  })

  it('uses sessionKey from context', () => {
    const hook = createBeforeToolCallHook(db)

    hook(
      { toolName: 'exec', params: { command: 'rm -rf /' } },
      { sessionKey: 'my-session', toolName: 'exec' },
    )

    expect(db.getTraceSteps('my-session')).toHaveLength(1)
  })

  it('falls back to "unknown" when sessionKey is absent', () => {
    const hook = createBeforeToolCallHook(db)

    hook(
      { toolName: 'read', params: {} },
      { toolName: 'read' },
    )

    expect(db.getTraceSteps('unknown')).toHaveLength(1)
  })

  it('records multiple tool calls in order', () => {
    const hook = createBeforeToolCallHook(db)

    hook({ toolName: 'read', params: {} }, { sessionKey: 's-1', toolName: 'read' })
    hook({ toolName: 'edit', params: {} }, { sessionKey: 's-1', toolName: 'edit' })
    hook({ toolName: 'exec', params: {} }, { sessionKey: 's-1', toolName: 'exec' })

    const steps = db.getTraceSteps('s-1')
    expect(steps).toHaveLength(3)
    expect(steps.map(s => s.action)).toEqual(['file:read', 'file:edit', 'shell:exec'])
  })

  it('never throws even if db throws', () => {
    const brokenDb = {
      ...db,
      insertTraceStep: () => { throw new Error('DB exploded') },
    } as unknown as Db

    const hook = createBeforeToolCallHook(brokenDb)

    expect(() => {
      hook(
        { toolName: 'read', params: { path: '/test.ts' } },
        { sessionKey: 'sess-1', toolName: 'read' },
      )
    }).not.toThrow()
  })
})
