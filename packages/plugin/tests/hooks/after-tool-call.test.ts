import { describe, it, expect, beforeEach } from 'vitest'
import { createAfterToolCallHook } from '../../src/hooks/after-tool-call.js'
import { toolCallBuffers, resetState } from '../../src/hooks/state.js'

describe('after_tool_call hook', () => {
  beforeEach(() => {
    resetState()
  })

  it('accumulates tool call records into the buffer', () => {
    const hook = createAfterToolCallHook()

    hook(
      { toolName: 'read', params: { path: '/foo/bar/baz.ts' }, durationMs: 10 },
      { sessionKey: 'sess-1', toolName: 'read' },
    )

    const buf = toolCallBuffers.get('sess-1')
    expect(buf).toBeDefined()
    expect(buf).toHaveLength(1)
    expect(buf![0].toolName).toBe('read')
    // Should store basename, not full path
    expect(buf![0].params.path).toBe('baz.ts')
    expect(buf![0].durationMs).toBe(10)
  })

  it('stores error and error signature', () => {
    const hook = createAfterToolCallHook()

    hook(
      { toolName: 'exec', params: { command: 'npm test' }, error: 'TypeError: x is not a function', durationMs: 500 },
      { sessionKey: 'sess-1', toolName: 'exec' },
    )

    const rec = toolCallBuffers.get('sess-1')![0]
    expect(rec.error).toBe('TypeError: x is not a function')
    expect(rec.result).toBeUndefined()
  })

  it('extracts first command token for exec tool', () => {
    const hook = createAfterToolCallHook()

    hook(
      { toolName: 'exec', params: { command: 'npx vitest run --reporter verbose' }, result: 'pass' },
      { sessionKey: 'sess-1', toolName: 'exec' },
    )

    const rec = toolCallBuffers.get('sess-1')![0]
    // exec command → first token stored as path
    expect(rec.params.path).toBe('npx')
  })

  it('does NOT store raw params content', () => {
    const hook = createAfterToolCallHook()

    hook(
      {
        toolName: 'write',
        params: {
          path: '/secret/dir/file.ts',
          content: 'super secret code with sk-abc123def456789xyz',
        },
      },
      { sessionKey: 'sess-1', toolName: 'write' },
    )

    const rec = toolCallBuffers.get('sess-1')![0]
    // Only basename, no content
    expect(rec.params.path).toBe('file.ts')
    expect(JSON.stringify(rec)).not.toContain('super secret')
    expect(JSON.stringify(rec)).not.toContain('sk-abc123')
  })

  it('limits buffer to 50 entries per session', () => {
    const hook = createAfterToolCallHook()

    for (let i = 0; i < 60; i++) {
      hook(
        { toolName: 'read', params: { path: `/file${i}.ts` }, result: 'ok' },
        { sessionKey: 'sess-1', toolName: 'read' },
      )
    }

    const buf = toolCallBuffers.get('sess-1')!
    expect(buf).toHaveLength(50)
    // Should keep the most recent entries
    expect(buf[buf.length - 1].params.path).toBe('file59.ts')
  })

  it('falls back to "unknown" when sessionKey is absent', () => {
    const hook = createAfterToolCallHook()

    hook(
      { toolName: 'read', params: { path: '/test.ts' } },
      { toolName: 'read' },
    )

    expect(toolCallBuffers.has('unknown')).toBe(true)
  })

  it('truncates result to 200 chars', () => {
    const hook = createAfterToolCallHook()
    const longResult = 'x'.repeat(500)

    hook(
      { toolName: 'exec', params: { command: 'cat big.txt' }, result: longResult },
      { sessionKey: 'sess-1', toolName: 'exec' },
    )

    const rec = toolCallBuffers.get('sess-1')![0]
    expect(rec.result!.length).toBeLessThanOrEqual(200)
  })

  it('stores "ok" for non-string truthy results', () => {
    const hook = createAfterToolCallHook()

    hook(
      { toolName: 'read', params: { path: '/f.ts' }, result: { lines: 42 } },
      { sessionKey: 'sess-1', toolName: 'read' },
    )

    expect(toolCallBuffers.get('sess-1')![0].result).toBe('ok')
  })

  it('never throws even on internal error', () => {
    const hook = createAfterToolCallHook()

    // Pass null to trigger internal error
    expect(() => {
      hook(
        { toolName: 'read', params: null as unknown as Record<string, unknown> },
        { sessionKey: 'sess-1', toolName: 'read' },
      )
    }).not.toThrow()
  })
})
