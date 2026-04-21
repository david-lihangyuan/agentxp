// M7 Batch 2.6 — auto-flush fallback.
// Drives the FlushController API in isolation from OpenClaw: callers
// feed onStep/onEnd calls, tests assert that onSessionEnd gets called
// when either the count or idle threshold is crossed, and never twice
// for the same batch of trace steps.
import { describe, it, expect } from 'vitest'
import { openPluginDb, type PluginDb } from '../src/db.js'
import { createFlushController } from '../src/flush.js'
import { onToolCall } from '../src/hooks.js'
import type { ToolCallCtx } from '../src/types.js'

const SESSION = 'sess-flush'
const SUMMARY = {
  what: 'auto-flush test',
  tried: 'n/a',
  outcome: 'inconclusive' as const,
  learned: 'n/a',
}

function tc(index: number, sessionId = SESSION): ToolCallCtx {
  return {
    session_id: sessionId,
    created_at: new Date(Date.UTC(2026, 3, 20, 0, index)).toISOString(),
    tool_call: {
      name: 'bash',
      arguments: { cmd: `echo step-${index}` },
      result: `stdout-${index}`,
      duration_ms: 10,
    },
  }
}

// Minimal manual-clock timer harness: flush controller stores pending
// callbacks here; tests advance the clock explicitly.
function fakeTimer() {
  interface Pending {
    fn: () => void
    at: number
    id: number
  }
  let nextId = 1
  let now = 0
  const pending = new Map<number, Pending>()
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++
      pending.set(id, { fn, at: now + ms, id })
      return id
    },
    clearTimer: (handle: unknown) => {
      pending.delete(handle as number)
    },
    advance: (ms: number) => {
      now += ms
      for (const [id, p] of [...pending.entries()]) {
        if (p.at <= now) {
          pending.delete(id)
          p.fn()
        }
      }
    },
    pendingCount: () => pending.size,
  }
}

function freshDb(): PluginDb {
  return openPluginDb(':memory:')
}

describe('FlushController — count-based auto-stage', () => {
  it('stages exactly one experience once N steps are captured and clears trace_steps', () => {
    const db = freshDb()
    try {
      const clock = fakeTimer()
      const ctrl = createFlushController({
        db,
        countThreshold: 3,
        idleMs: 0,
        summary: SUMMARY,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      })
      for (let i = 0; i < 3; i++) {
        onToolCall(db, tc(i))
        ctrl.onStep(SESSION)
      }
      const staged = db.listAllExperiences()
      expect(staged.length).toBe(1)
      expect(staged[0]!.reason).toBe('auto_count')
      expect(db.listTraceSteps(SESSION).length).toBe(0)
    } finally {
      db.close()
    }
  })

  it('does not stage again before another N steps accumulate', () => {
    const db = freshDb()
    try {
      const clock = fakeTimer()
      const ctrl = createFlushController({
        db,
        countThreshold: 3,
        idleMs: 0,
        summary: SUMMARY,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      })
      for (let i = 0; i < 5; i++) {
        onToolCall(db, tc(i))
        ctrl.onStep(SESSION)
      }
      expect(db.listAllExperiences().length).toBe(1)
      for (let i = 5; i < 8; i++) {
        onToolCall(db, tc(i))
        ctrl.onStep(SESSION)
      }
      expect(db.listAllExperiences().length).toBe(2)
    } finally {
      db.close()
    }
  })

  it('is disabled when countThreshold is 0', () => {
    const db = freshDb()
    try {
      const clock = fakeTimer()
      const ctrl = createFlushController({
        db,
        countThreshold: 0,
        idleMs: 0,
        summary: SUMMARY,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      })
      for (let i = 0; i < 50; i++) {
        onToolCall(db, tc(i))
        ctrl.onStep(SESSION)
      }
      expect(db.listAllExperiences().length).toBe(0)
      expect(db.listTraceSteps(SESSION).length).toBe(50)
    } finally {
      db.close()
    }
  })
})

describe('FlushController — idle-based auto-stage', () => {
  it('stages one experience once idleMs elapses with no new steps', () => {
    const db = freshDb()
    try {
      const clock = fakeTimer()
      const ctrl = createFlushController({
        db,
        countThreshold: 0,
        idleMs: 5_000,
        summary: SUMMARY,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      })
      onToolCall(db, tc(0))
      ctrl.onStep(SESSION)
      onToolCall(db, tc(1))
      ctrl.onStep(SESSION)
      // Not yet elapsed.
      clock.advance(4_999)
      expect(db.listAllExperiences().length).toBe(0)
      // Cross the threshold.
      clock.advance(1)
      expect(db.listAllExperiences().length).toBe(1)
      expect(db.listAllExperiences()[0]!.reason).toBe('auto_idle')
      expect(db.listTraceSteps(SESSION).length).toBe(0)
    } finally {
      db.close()
    }
  })

  it('resets the idle timer on every new step', () => {
    const db = freshDb()
    try {
      const clock = fakeTimer()
      const ctrl = createFlushController({
        db,
        countThreshold: 0,
        idleMs: 5_000,
        summary: SUMMARY,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      })
      onToolCall(db, tc(0))
      ctrl.onStep(SESSION)
      clock.advance(4_000)
      onToolCall(db, tc(1))
      ctrl.onStep(SESSION) // resets timer
      clock.advance(4_000)
      expect(db.listAllExperiences().length).toBe(0)
      clock.advance(1_000)
      expect(db.listAllExperiences().length).toBe(1)
    } finally {
      db.close()
    }
  })

  it('onEnd clears pending idle timer (no phantom flush after session ended)', () => {
    const db = freshDb()
    try {
      const clock = fakeTimer()
      const ctrl = createFlushController({
        db,
        countThreshold: 0,
        idleMs: 5_000,
        summary: SUMMARY,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      })
      onToolCall(db, tc(0))
      ctrl.onStep(SESSION)
      ctrl.onEnd(SESSION)
      expect(clock.pendingCount()).toBe(0)
      clock.advance(10_000)
      expect(db.listAllExperiences().length).toBe(0)
    } finally {
      db.close()
    }
  })

  it('is disabled when idleMs is 0', () => {
    const db = freshDb()
    try {
      const clock = fakeTimer()
      const ctrl = createFlushController({
        db,
        countThreshold: 0,
        idleMs: 0,
        summary: SUMMARY,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      })
      onToolCall(db, tc(0))
      ctrl.onStep(SESSION)
      clock.advance(1_000_000)
      expect(db.listAllExperiences().length).toBe(0)
      expect(clock.pendingCount()).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('FlushController — per-session isolation and shutdown', () => {
  it('tracks count/idle state independently across sessions', () => {
    const db = freshDb()
    try {
      const clock = fakeTimer()
      const ctrl = createFlushController({
        db,
        countThreshold: 3,
        idleMs: 0,
        summary: SUMMARY,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      })
      for (let i = 0; i < 2; i++) {
        onToolCall(db, tc(i, 'sess-a'))
        ctrl.onStep('sess-a')
      }
      for (let i = 0; i < 3; i++) {
        onToolCall(db, tc(i, 'sess-b'))
        ctrl.onStep('sess-b')
      }
      const staged = db.listAllExperiences()
      expect(staged.length).toBe(1)
      expect(staged[0]!.session_id).toBe('sess-b')
      expect(db.listTraceSteps('sess-a').length).toBe(2)
      expect(db.listTraceSteps('sess-b').length).toBe(0)
    } finally {
      db.close()
    }
  })

  it('shutdown clears every pending timer', () => {
    const db = freshDb()
    try {
      const clock = fakeTimer()
      const ctrl = createFlushController({
        db,
        countThreshold: 0,
        idleMs: 5_000,
        summary: SUMMARY,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      })
      onToolCall(db, tc(0, 'sess-a'))
      ctrl.onStep('sess-a')
      onToolCall(db, tc(0, 'sess-b'))
      ctrl.onStep('sess-b')
      expect(clock.pendingCount()).toBe(2)
      ctrl.shutdown()
      expect(clock.pendingCount()).toBe(0)
    } finally {
      db.close()
    }
  })
})
