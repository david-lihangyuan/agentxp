// SPEC 03-modules-product §5 acceptance cases + MILESTONES M4 checks.
import { describe, it, expect } from 'vitest'
import {
  onMessageSending,
  onToolCall,
  onSessionEnd,
  buildTrace,
} from '../src/hooks.js'
import { openPluginDb } from '../src/db.js'
import type { ToolCallCtx, SessionEndCtx, MessageSendingCtx } from '../src/types.js'

function freshDb() {
  return openPluginDb(':memory:')
}

const SESSION = 'sess-1'

function tc(index: number, name = 'bash'): ToolCallCtx {
  return {
    session_id: SESSION,
    created_at: new Date(Date.UTC(2026, 3, 18, 0, index)).toISOString(),
    tool_call: {
      name,
      arguments: { cmd: `echo step-${index}` },
      result: `stdout-${index}`,
      duration_ms: 120 + index,
    },
  }
}

describe('Tier 1 — message_sending (MILESTONES M4 check 2)', () => {
  it('returns a rule-based signal with llm_tokens=0', () => {
    const ctx: MessageSendingCtx = {
      session_id: SESSION,
      created_at: new Date().toISOString(),
      tool_call: { name: 'bash', arguments: { cmd: 'ls' } },
    }
    const sig = onMessageSending(ctx)
    expect(sig.llm_tokens).toBe(0)
    expect(sig.flag).toBe('ok')
  })

  it('flags destructive arguments', () => {
    const ctx: MessageSendingCtx = {
      session_id: SESSION,
      created_at: new Date().toISOString(),
      tool_call: { name: 'bash', arguments: { cmd: 'rm -rf /' } },
    }
    const sig = onMessageSending(ctx)
    expect(sig.flag).toBe('suspect_destructive')
    expect(sig.llm_tokens).toBe(0)
  })
})

describe('Tier 2 — session lifecycle (SPEC §5 acceptance 1)', () => {
  it('three tool_call hooks + session_end stage one experience with 3 trace steps', () => {
    const db = freshDb()
    try {
      onToolCall(db, tc(0))
      onToolCall(db, tc(1, 'read_file'))
      onToolCall(db, tc(2, 'edit_file'))

      const endCtx: SessionEndCtx = {
        session_id: SESSION,
        ended_at: new Date().toISOString(),
        reason: 'exit',
      }
      const res = onSessionEnd(db, endCtx, {
        what: 'Wired plugin hooks',
        tried: 'Three tool calls',
        outcome: 'succeeded',
        learned: 'The trace carries three steps',
        tags: ['m4'],
      })
      expect(res.staged).toBe(true)

      const staged = db.listAllExperiences()
      expect(staged.length).toBe(1)
      const trace = JSON.parse(staged[0]!.trace_json) as {
        steps: unknown[]
      }
      expect(trace.steps.length).toBe(3)
    } finally {
      db.close()
    }
  })

  it('zero tool calls + non-explicit session_end does NOT stage anything (SPEC §5 acceptance 2)', () => {
    const db = freshDb()
    try {
      const res = onSessionEnd(
        db,
        {
          session_id: SESSION,
          ended_at: new Date().toISOString(),
          reason: 'idle',
        },
        {
          what: 'no-op',
          tried: 'nothing',
          outcome: 'inconclusive',
          learned: 'n/a',
        },
      )
      expect(res.staged).toBe(false)
      expect(db.listAllExperiences().length).toBe(0)
    } finally {
      db.close()
    }
  })

  it('explicit reflect stages even with zero steps', () => {
    const db = freshDb()
    try {
      const res = onSessionEnd(
        db,
        {
          session_id: SESSION,
          ended_at: new Date().toISOString(),
          reason: 'explicit',
        },
        {
          what: 'manual reflection',
          tried: 'agentxp reflect',
          outcome: 'succeeded',
          learned: 'Explicit reflect always stages',
        },
      )
      expect(res.staged).toBe(true)
      expect(db.listAllExperiences().length).toBe(1)
    } finally {
      db.close()
    }
  })
})

describe('buildTrace', () => {
  it('produces duration_bucket and tools_used_category from staged steps', () => {
    const db = freshDb()
    try {
      onToolCall(db, tc(0, 'bash'))
      onToolCall(db, tc(1, 'bash'))
      onToolCall(db, tc(2, 'read_file'))
      const trace = buildTrace(db.listTraceSteps(SESSION), 'ctx')
      expect(trace.duration_bucket).toBe('under_1min')
      expect(new Set(trace.tools_used_category)).toEqual(new Set(['bash', 'read_file']))
      expect(trace.trace_worthiness).toBe('high')
    } finally {
      db.close()
    }
  })
})
