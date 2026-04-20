// SPEC 03-modules-product §5 acceptance 1 (happy relay round-trip),
// acceptance 3 (503 retention & retry), MILESTONES M4 checks 1 & 3.
import { describe, it, expect } from 'vitest'
import { onToolCall, onSessionEnd } from '../src/hooks.js'
import { openPluginDb } from '../src/db.js'
import { publishStagedExperiences } from '../src/publisher.js'
import {
  startInMemoryRelay,
  makeOperatorKey,
  makeAgentKey,
  registerOperatorAndAgent,
} from './helpers.js'
import type { ToolCallCtx, SessionEndCtx } from '../src/types.js'

function tc(sess: string, i: number): ToolCallCtx {
  return {
    session_id: sess,
    created_at: new Date(Date.UTC(2026, 3, 18, 0, i)).toISOString(),
    tool_call: {
      name: i === 2 ? 'edit_file' : 'bash',
      arguments: { cmd: `echo step-${i}` },
      result: `ok-${i}`,
      duration_ms: 150,
    },
  }
}

const SUMMARY = {
  what: 'Plugin v3 round-trip',
  tried: 'Staged 3 steps and flushed at session_end',
  outcome: 'succeeded' as const,
  learned: 'Trace is carried through to the relay',
  tags: ['m4', 'plugin-v3'],
}

describe('publishStagedExperiences (MILESTONES M4 check 1)', () => {
  it('publishes one experience with reasoning_trace.steps.length===3', async () => {
    const relay = startInMemoryRelay()
    const operator = makeOperatorKey()
    const agent = makeAgentKey(operator, 'plugin-happy')
    await registerOperatorAndAgent(relay, operator, agent)

    const db = openPluginDb(':memory:')
    try {
      const sess = 'sess-happy'
      onToolCall(db, tc(sess, 0))
      onToolCall(db, tc(sess, 1))
      onToolCall(db, tc(sess, 2))
      const endCtx: SessionEndCtx = {
        session_id: sess,
        ended_at: new Date().toISOString(),
        reason: 'exit',
      }
      onSessionEnd(db, endCtx, SUMMARY)

      const results = await publishStagedExperiences({
        relayUrl: relay.origin,
        agent,
        db,
        fetch: relay.fetch,
      })
      expect(results.length).toBe(1)
      expect(results[0]!.status).toBe('published')

      // trace steps + staged experience must both be cleared
      expect(db.listAllExperiences().length).toBe(0)
      expect(db.listTraceSteps(sess).length).toBe(0)

      const searchRes = await relay.fetch(`${relay.origin}/api/v1/search?q=round-trip`)
      const body = (await searchRes.json()) as { results: Array<{ event_id: string }> }
      expect(body.results.length).toBeGreaterThan(0)

      const eventRes = await relay.fetch(
        `${relay.origin}/api/v1/events/${results[0]!.eventId}`,
      )
      const eventBody = (await eventRes.json()) as {
        event: { payload: { reasoning_trace: { steps: unknown[] } } }
      }
      expect(eventBody.event.payload.reasoning_trace.steps.length).toBe(3)
    } finally {
      db.close()
    }
  })
})

describe('publishStagedExperiences — 503 retention (MILESTONES M4 check 3; SPEC §5 acceptance 3)', () => {
  it('retains staged rows and trace steps after a 503 and increments retry_count', async () => {
    const operator = makeOperatorKey()
    const agent = makeAgentKey(operator)

    const db = openPluginDb(':memory:')
    try {
      const sess = 'sess-flaky'
      onToolCall(db, tc(sess, 0))
      onToolCall(db, tc(sess, 1))
      onSessionEnd(
        db,
        { session_id: sess, ended_at: new Date().toISOString(), reason: 'exit' },
        SUMMARY,
      )

      const flakyFetch: typeof globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: 'upstream_unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })

      const results = await publishStagedExperiences({
        relayUrl: 'http://relay.test',
        agent,
        db,
        fetch: flakyFetch,
        random: () => 0.5,
      })
      expect(results.length).toBe(1)
      expect(results[0]!.status).toBe('retry')
      expect(results[0]!.httpStatus).toBe(503)

      const staged = db.listAllExperiences()
      expect(staged.length).toBe(1)
      expect(staged[0]!.retry_count).toBe(1)
      // Trace steps are cleared by onSessionEnd once they are folded
      // into the staged experience's trace_json; retry preserves the
      // staged row, not the raw step ledger.
      expect(db.listTraceSteps(sess).length).toBe(0)
      const stagedTrace = JSON.parse(staged[0]!.trace_json) as { steps: unknown[] }
      expect(stagedTrace.steps.length).toBe(2)
    } finally {
      db.close()
    }
  })

  it('abandons a row after MAX_ATTEMPTS but does not delete it locally', async () => {
    const operator = makeOperatorKey()
    const agent = makeAgentKey(operator)
    const db = openPluginDb(':memory:')
    try {
      const sess = 'sess-maxed'
      onToolCall(db, tc(sess, 0))
      onSessionEnd(
        db,
        { session_id: sess, ended_at: new Date().toISOString(), reason: 'exit' },
        SUMMARY,
      )
      // mutate retry_count directly to simulate 5 prior attempts
      const row = db.listAllExperiences()[0]!
      db.markAttempt(row.id, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))
      for (let i = 1; i < 5; i++) {
        db.markAttempt(row.id, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))
      }
      const res = await publishStagedExperiences({
        relayUrl: 'http://relay.test',
        agent,
        db,
        fetch: async () => new Response('', { status: 503 }),
      })
      expect(res[0]!.status).toBe('abandoned')
      expect(db.listAllExperiences().length).toBe(1)
    } finally {
      db.close()
    }
  })
})
