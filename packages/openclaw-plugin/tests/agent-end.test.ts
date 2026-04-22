// M7 Batch 1 — onAgentEnd contract.
// agent_end fires when the host process winds down. It is a *flush*
// point only: if session_end was not fired for a given session_id,
// any staged-but-unflushed trace steps for that session MUST be
// dropped (they will never be published — there is no summary).
// agent_end itself does not stage new experiences.
import { describe, it, expect } from 'vitest'
import { onAgentEnd, onToolCall, onSessionEnd } from '../src/hooks.js'
import { openPluginDb } from '../src/db.js'
import type { AgentEndCtx, ToolCallCtx, SessionEndCtx } from '../src/types.js'

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

describe('onAgentEnd', () => {
  it('is a no-op when the session has no staged trace steps', () => {
    const db = freshDb()
    try {
      const ctx: AgentEndCtx = { session_id: 'sess-idle', success: true }
      const res = onAgentEnd(db, ctx)
      expect(res.dropped_steps).toBe(0)
      expect(res.staged_experiences_before).toBe(0)
      expect(db.listAllExperiences().length).toBe(0)
    } finally {
      db.close()
    }
  })

  it('drops orphan trace steps that were never closed by session_end', () => {
    const db = freshDb()
    try {
      onToolCall(db, tc('sess-orphan', 0))
      onToolCall(db, tc('sess-orphan', 1))
      expect(db.listTraceSteps('sess-orphan').length).toBe(2)

      const res = onAgentEnd(db, { session_id: 'sess-orphan', success: false })
      expect(res.dropped_steps).toBe(2)
      expect(db.listTraceSteps('sess-orphan').length).toBe(0)
      expect(db.listAllExperiences().length).toBe(0)
    } finally {
      db.close()
    }
  })

  it('does not touch already-staged experiences', () => {
    const db = freshDb()
    try {
      onToolCall(db, tc('sess-done', 0))
      const endCtx: SessionEndCtx = {
        session_id: 'sess-done',
        ended_at: new Date().toISOString(),
        reason: 'exit',
      }
      onSessionEnd(db, endCtx, {
        what: 'done',
        tried: 'one step',
        outcome: 'succeeded',
        learned: 'ok',
      })
      expect(db.listAllExperiences().length).toBe(1)

      const res = onAgentEnd(db, { session_id: 'sess-done', success: true })
      expect(res.dropped_steps).toBe(0)
      expect(res.staged_experiences_before).toBe(1)
      expect(db.listAllExperiences().length).toBe(1)
    } finally {
      db.close()
    }
  })

  it('throws on empty session_id', () => {
    const db = freshDb()
    try {
      expect(() => onAgentEnd(db, { session_id: '', success: true })).toThrow(/session_id/)
    } finally {
      db.close()
    }
  })
})
