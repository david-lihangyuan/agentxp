import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../../src/db.js'
import type { Db } from '../../src/db.js'
import { createSessionStartHook, createSessionEndHook } from '../../src/hooks/session-lifecycle.js'
import { toolCallBuffers, resetState } from '../../src/hooks/state.js'

describe('session_start hook', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
    resetState()
  })

  afterEach(() => {
    db.close()
    resetState()
  })

  it('is a no-op (does not throw)', () => {
    const hook = createSessionStartHook(db)

    expect(() => {
      hook(
        { sessionId: 'sess-1', sessionKey: 'sk-1' },
        { sessionId: 'sess-1', sessionKey: 'sk-1' },
      )
    }).not.toThrow()
  })
})

describe('session_end hook', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
    resetState()
  })

  afterEach(() => {
    db.close()
    resetState()
  })

  it('clears context_cache for the session', () => {
    // Seed context cache
    db.upsertContextCache({ sessionId: 'sk-1', keywords: ['vitest', 'typescript'] })
    expect(db.getContextCache('sk-1')).not.toBeNull()

    const hook = createSessionEndHook(db)
    hook(
      { sessionId: 'sess-1', sessionKey: 'sk-1' },
      { sessionId: 'sess-1', sessionKey: 'sk-1' },
    )

    expect(db.getContextCache('sk-1')).toBeNull()
  })

  it('clears tool call buffers for the session', () => {
    toolCallBuffers.set('sk-1', [
      { toolName: 'read', params: { path: 'a.ts' }, result: 'ok', durationMs: 5 },
    ])

    const hook = createSessionEndHook(db)
    hook(
      { sessionId: 'sess-1', sessionKey: 'sk-1' },
      { sessionId: 'sess-1', sessionKey: 'sk-1' },
    )

    expect(toolCallBuffers.has('sk-1')).toBe(false)
  })

  it('falls back to sessionId when sessionKey is absent', () => {
    db.upsertContextCache({ sessionId: 'sess-1', keywords: ['test'] })
    toolCallBuffers.set('sess-1', [
      { toolName: 'read', params: {}, result: 'ok', durationMs: 5 },
    ])

    const hook = createSessionEndHook(db)
    hook(
      { sessionId: 'sess-1' },
      { sessionId: 'sess-1' },
    )

    expect(db.getContextCache('sess-1')).toBeNull()
    expect(toolCallBuffers.has('sess-1')).toBe(false)
  })

  it('does not affect other sessions', () => {
    db.upsertContextCache({ sessionId: 'sk-1', keywords: ['test1'] })
    db.upsertContextCache({ sessionId: 'sk-2', keywords: ['test2'] })
    toolCallBuffers.set('sk-1', [{ toolName: 'read', params: {}, result: 'ok', durationMs: 5 }])
    toolCallBuffers.set('sk-2', [{ toolName: 'exec', params: {}, result: 'ok', durationMs: 10 }])

    const hook = createSessionEndHook(db)
    hook(
      { sessionId: 'sess-1', sessionKey: 'sk-1' },
      { sessionId: 'sess-1', sessionKey: 'sk-1' },
    )

    // sk-1 cleared
    expect(db.getContextCache('sk-1')).toBeNull()
    expect(toolCallBuffers.has('sk-1')).toBe(false)

    // sk-2 intact
    expect(db.getContextCache('sk-2')).not.toBeNull()
    expect(toolCallBuffers.has('sk-2')).toBe(true)
  })

  it('never throws even if db throws', () => {
    const brokenDb = {
      ...db,
      deleteContextCache: () => { throw new Error('DB exploded') },
    } as unknown as Db

    const hook = createSessionEndHook(brokenDb)

    expect(() => {
      hook(
        { sessionId: 'sess-1', sessionKey: 'sk-1' },
        { sessionId: 'sess-1', sessionKey: 'sk-1' },
      )
    }).not.toThrow()
  })
})
