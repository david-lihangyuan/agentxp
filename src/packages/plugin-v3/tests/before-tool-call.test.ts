// M7 Batch 1 — onBeforeToolCall contract.
// Tier-1 rule-based gate that may block a tool call before it fires.
// Same DESTRUCTIVE lexicon as onMessageSending; returns void to allow
// and a block descriptor to deny. Always zero LLM tokens.
import { describe, it, expect } from 'vitest'
import { onBeforeToolCall } from '../src/hooks.js'
import type { BeforeToolCallCtx } from '../src/types.js'

const SESSION = 'sess-btc'

function ctx(args: unknown, name = 'bash'): BeforeToolCallCtx {
  return {
    session_id: SESSION,
    tool_name: name,
    arguments: args,
  }
}

describe('onBeforeToolCall', () => {
  it('allows benign tool calls (returns undefined, llm_tokens=0)', () => {
    const res = onBeforeToolCall(ctx({ cmd: 'ls -la' }))
    expect(res.blocked).toBe(false)
    expect(res.llm_tokens).toBe(0)
    expect(res.block_reason).toBeUndefined()
  })

  it('blocks destructive shell (rm -rf)', () => {
    const res = onBeforeToolCall(ctx({ cmd: 'rm -rf /tmp/foo' }))
    expect(res.blocked).toBe(true)
    expect(res.block_reason).toMatch(/destructive/i)
    expect(res.llm_tokens).toBe(0)
  })

  it('blocks destructive SQL (DROP TABLE)', () => {
    const res = onBeforeToolCall(ctx({ sql: 'DROP TABLE users' }, 'sqlite'))
    expect(res.blocked).toBe(true)
    expect(res.block_reason).toMatch(/destructive/i)
  })

  it('blocks force-push', () => {
    const res = onBeforeToolCall(
      ctx({ cmd: 'git push --force origin main' }, 'bash'),
    )
    expect(res.blocked).toBe(true)
  })

  it('allows null / undefined arguments without throwing', () => {
    const res1 = onBeforeToolCall(ctx(null))
    const res2 = onBeforeToolCall(ctx(undefined))
    expect(res1.blocked).toBe(false)
    expect(res2.blocked).toBe(false)
  })

  it('throws on empty tool_name', () => {
    expect(() =>
      onBeforeToolCall({
        session_id: SESSION,
        tool_name: '',
        arguments: {},
      }),
    ).toThrow(/tool_name/)
  })
})
