// onMessageSending must feed the shared session-state so the
// memory-prompt builder can see the active session, its tool history,
// and extracted keywords (M7 Batch 2).
import { describe, it, expect, beforeEach } from 'vitest'
import { onMessageSending } from '../src/hooks.js'
import {
  resetSessionState,
  getLastActiveSession,
  getSessionState,
} from '../src/session-state.js'
import type { MessageSendingCtx } from '../src/types.js'

function msg(sessionId: string, toolName: string, args: unknown): MessageSendingCtx {
  return {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    tool_call: { name: toolName, arguments: args },
  }
}

describe('onMessageSending · session-state wiring', () => {
  beforeEach(() => {
    resetSessionState()
  })

  it('marks the session as last-active', () => {
    onMessageSending(msg('sess-A', 'Read', { path: '/tmp/foo.ts' }))
    expect(getLastActiveSession()).toBe('sess-A')
  })

  it('pushes tool name and increments tool count', () => {
    onMessageSending(msg('sess-B', 'Read', {}))
    onMessageSending(msg('sess-B', 'Bash', { cmd: 'ls' }))
    onMessageSending(msg('sess-B', 'Edit', {}))
    const state = getSessionState('sess-B')
    expect(state!.toolNames).toEqual(['Read', 'Bash', 'Edit'])
    expect(state!.toolCount).toBe(3)
  })

  it('extracts keywords from string-typed argument values', () => {
    onMessageSending(msg('sess-C', 'Grep', { pattern: 'flaky vitest' }))
    const state = getSessionState('sess-C')
    expect(state!.keywords).toContain('flaky')
    expect(state!.keywords).toContain('vitest')
  })

  it('extracts keywords from path segments in arguments', () => {
    onMessageSending(msg('sess-D', 'Read', { path: '/repo/packages/protocol/src/sign.ts' }))
    const state = getSessionState('sess-D')
    // Path segments (splitting on / and .) should seed keywords.
    expect(state!.keywords).toContain('protocol')
    expect(state!.keywords).toContain('sign')
  })

  it('does not blow up on null / undefined / numeric arguments', () => {
    onMessageSending(msg('sess-E', 'Noop', null))
    onMessageSending(msg('sess-E', 'Noop', undefined))
    onMessageSending(msg('sess-E', 'Noop', 42))
    const state = getSessionState('sess-E')
    expect(state!.toolCount).toBe(3)
    // No crash, keywords stay valid (possibly empty).
    expect(Array.isArray(state!.keywords)).toBe(true)
  })

  it('preserves the existing rule-based signal return value', () => {
    const sig = onMessageSending(msg('sess-F', 'Bash', { cmd: 'echo hi' }))
    expect(sig.flag).toBe('ok')
    expect(sig.llm_tokens).toBe(0)
  })

  it('still flags destructive args AND records session activity', () => {
    const sig = onMessageSending(msg('sess-G', 'Bash', { cmd: 'rm -rf /' }))
    expect(sig.flag).toBe('suspect_destructive')
    const state = getSessionState('sess-G')
    expect(state!.toolCount).toBe(1)
    expect(getLastActiveSession()).toBe('sess-G')
  })
})
