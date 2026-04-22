// M7 Batch 1 — onSessionStart contract.
// The hook clears any stale trace steps for the same session_id so a
// crash-restart cannot bleed half-captured steps into the next session.
// When resumed_from is set the hook preserves steps (the host is
// telling us this is a continuation, not a fresh boot).
import { describe, it, expect } from 'vitest'
import { onSessionStart, onToolCall } from '../src/hooks.js'
import { openPluginDb } from '../src/db.js'
import type { SessionStartCtx, ToolCallCtx } from '../src/types.js'

function freshDb() {
  return openPluginDb(':memory:')
}

function tc(sessionId: string, index: number): ToolCallCtx {
  return {
    session_id: sessionId,
    created_at: new Date(Date.UTC(2026, 3, 19, 0, index)).toISOString(),
    tool_call: {
      name: 'bash',
      arguments: { cmd: `echo ${index}` },
      result: `stdout-${index}`,
      duration_ms: 100,
    },
  }
}

describe('onSessionStart', () => {
  it('returns a signal with resumed=false for a fresh session', () => {
    const db = freshDb()
    try {
      const ctx: SessionStartCtx = { session_id: 'sess-new' }
      const sig = onSessionStart(db, ctx)
      expect(sig.session_id).toBe('sess-new')
      expect(sig.resumed).toBe(false)
      expect(sig.cleared_steps).toBe(0)
    } finally {
      db.close()
    }
  })

  it('drops any stale trace steps for the same session_id on a fresh start', () => {
    const db = freshDb()
    try {
      onToolCall(db, tc('sess-stale', 0))
      onToolCall(db, tc('sess-stale', 1))
      expect(db.listTraceSteps('sess-stale').length).toBe(2)

      const sig = onSessionStart(db, { session_id: 'sess-stale' })
      expect(sig.resumed).toBe(false)
      expect(sig.cleared_steps).toBe(2)
      expect(db.listTraceSteps('sess-stale').length).toBe(0)
    } finally {
      db.close()
    }
  })

  it('preserves existing trace steps when resumed_from is set', () => {
    const db = freshDb()
    try {
      onToolCall(db, tc('sess-resume', 0))
      const sig = onSessionStart(db, {
        session_id: 'sess-resume',
        resumed_from: 'sess-prev',
      })
      expect(sig.resumed).toBe(true)
      expect(sig.cleared_steps).toBe(0)
      expect(db.listTraceSteps('sess-resume').length).toBe(1)
    } finally {
      db.close()
    }
  })

  it('throws on an empty session_id', () => {
    const db = freshDb()
    try {
      expect(() => onSessionStart(db, { session_id: '' })).toThrow(/session_id/)
    } finally {
      db.close()
    }
  })
})
