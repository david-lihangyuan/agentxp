// startPublishLoop schedules publishStagedExperiences on an interval,
// guards against overlapping cycles, surfaces publisher errors to an
// onError hook, and can be stopped cleanly.
import { describe, expect, it, vi } from 'vitest'

import { openPluginDb } from '../src/db.js'
import { onSessionEnd, onToolCall } from '../src/hooks.js'
import { startPublishLoop } from '../src/publish-loop.js'
import type { SessionEndCtx, ToolCallCtx } from '../src/types.js'
import {
  makeAgentKey,
  makeOperatorKey,
  registerOperatorAndAgent,
  startInMemoryRelay,
} from './helpers.js'

const SUMMARY = {
  what: 'publish-loop smoke',
  tried: 'echo one tool call',
  learned: 'round-trip ok',
  outcome: 'succeeded' as const,
  tags: ['m7', 'batch-2-7'],
}

function tc(session: string, i: number): ToolCallCtx {
  return {
    session_id: session,
    created_at: new Date(Date.UTC(2026, 3, 20, 0, i)).toISOString(),
    tool_call: {
      name: 'bash',
      arguments: { cmd: `echo ${i}` },
      result: `ok-${i}`,
      duration_ms: 1,
    },
  }
}

async function stageOne(): Promise<ReturnType<typeof openPluginDb>> {
  const db = openPluginDb(':memory:')
  onToolCall(db, tc('s1', 0))
  const end: SessionEndCtx = {
    session_id: 's1', ended_at: new Date().toISOString(), reason: 'exit',
  }
  onSessionEnd(db, end, SUMMARY)
  return db
}

describe('startPublishLoop', () => {
  it('rejects non-positive intervalMs', async () => {
    const relay = startInMemoryRelay()
    const op = makeOperatorKey()
    const agent = makeAgentKey(op, 'loop-0')
    const db = openPluginDb(':memory:')
    expect(() =>
      startPublishLoop({ db, agent, relayUrl: relay.origin, intervalMs: 0 }),
    ).toThrow(/positive finite number/)
    db.close()
  })

  it('runNow publishes any due staged experiences', async () => {
    const relay = startInMemoryRelay()
    const op = makeOperatorKey()
    const agent = makeAgentKey(op, 'loop-1')
    await registerOperatorAndAgent(relay, op, agent)

    const db = await stageOne()
    const onResult = vi.fn()
    const handle = startPublishLoop({
      db, agent, relayUrl: relay.origin, intervalMs: 60_000,
      fetch: relay.fetch, onResult,
    })
    try {
      const results = await handle.runNow()
      expect(results).toHaveLength(1)
      expect(results[0]?.status).toBe('published')
      expect(onResult).toHaveBeenCalledTimes(1)
    } finally {
      handle.stop()
      db.close()
    }
  })

  it('stop() cancels pending timers and further runNow is a noop', async () => {
    const relay = startInMemoryRelay()
    const op = makeOperatorKey()
    const agent = makeAgentKey(op, 'loop-2')
    await registerOperatorAndAgent(relay, op, agent)

    const db = await stageOne()
    const handle = startPublishLoop({
      db, agent, relayUrl: relay.origin, intervalMs: 60_000, fetch: relay.fetch,
    })
    handle.stop()
    const results = await handle.runNow()
    expect(results).toEqual([])
    db.close()
  })

  it('routes publisher errors to onError without stopping the loop', async () => {
    const op = makeOperatorKey()
    const agent = makeAgentKey(op, 'loop-3')
    const db = await stageOne()
    const onError = vi.fn()
    const brokenFetch: typeof globalThis.fetch = async () => {
      throw new Error('network down')
    }
    const handle = startPublishLoop({
      db, agent, relayUrl: 'http://relay.test', intervalMs: 60_000,
      fetch: brokenFetch, onError,
    })
    try {
      // publisher catches fetch errors and records a retry; loop
      // itself never throws. onError should be untouched.
      const results = await handle.runNow()
      expect(results).toHaveLength(1)
      expect(results[0]?.status).toBe('retry')
      expect(onError).not.toHaveBeenCalled()
    } finally {
      handle.stop()
      db.close()
    }
  })

  it('overlapping runNow cycles are serialised (reentrancy guard)', async () => {
    const relay = startInMemoryRelay()
    const op = makeOperatorKey()
    const agent = makeAgentKey(op, 'loop-4')
    await registerOperatorAndAgent(relay, op, agent)

    const db = await stageOne()
    const handle = startPublishLoop({
      db, agent, relayUrl: relay.origin, intervalMs: 60_000, fetch: relay.fetch,
    })
    try {
      const [a, b] = await Promise.all([handle.runNow(), handle.runNow()])
      // One cycle publishes; the reentrant one short-circuits with [].
      const published = [...(a ?? []), ...(b ?? [])].filter(
        (r) => r.status === 'published',
      )
      expect(published).toHaveLength(1)
    } finally {
      handle.stop()
      db.close()
    }
  })
})
