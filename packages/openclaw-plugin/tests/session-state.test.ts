// Module-level session state for the memory-prompt builder (M7
// Batch 2). The OpenClaw MemoryPromptSectionBuilder signature does
// not accept a session argument, so the builder has to look up the
// current session elsewhere; our hooks keep a small in-memory map
// and feed it from onMessageSending.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setLastActiveSession,
  getLastActiveSession,
  pushToolName,
  pushKeywords,
  getSessionState,
  resetSessionState,
  MAX_TOOL_HISTORY,
  MAX_KEYWORD_HISTORY,
} from '../src/session-state.js'

describe('session-state', () => {
  beforeEach(() => {
    resetSessionState()
  })

  it('returns undefined for the active session before any hook fires', () => {
    expect(getLastActiveSession()).toBeUndefined()
    expect(getSessionState('never-seen')).toBeUndefined()
  })

  it('tracks the most recent active session', () => {
    setLastActiveSession('sess-A')
    expect(getLastActiveSession()).toBe('sess-A')
    setLastActiveSession('sess-B')
    expect(getLastActiveSession()).toBe('sess-B')
  })

  it('records tool names and increments tool count', () => {
    setLastActiveSession('sess-1')
    pushToolName('sess-1', 'Read')
    pushToolName('sess-1', 'Bash')
    pushToolName('sess-1', 'Edit')

    const state = getSessionState('sess-1')
    expect(state).toBeDefined()
    expect(state!.toolNames).toEqual(['Read', 'Bash', 'Edit'])
    expect(state!.toolCount).toBe(3)
  })

  it('accumulates keywords across multiple pushes without duplicates', () => {
    setLastActiveSession('sess-2')
    pushKeywords('sess-2', ['read', 'index'])
    pushKeywords('sess-2', ['index', 'search'])

    const state = getSessionState('sess-2')
    expect(state!.keywords).toEqual(['read', 'index', 'search'])
  })

  it('keeps tool history bounded to MAX_TOOL_HISTORY', () => {
    setLastActiveSession('sess-3')
    for (let i = 0; i < MAX_TOOL_HISTORY + 5; i++) {
      pushToolName('sess-3', `tool-${i}`)
    }
    const state = getSessionState('sess-3')
    expect(state!.toolNames.length).toBe(MAX_TOOL_HISTORY)
    // Oldest entries evicted; newest preserved
    expect(state!.toolNames[state!.toolNames.length - 1]).toBe(
      `tool-${MAX_TOOL_HISTORY + 4}`,
    )
    // toolCount keeps the full running total even after eviction
    expect(state!.toolCount).toBe(MAX_TOOL_HISTORY + 5)
  })

  it('keeps keyword history bounded to MAX_KEYWORD_HISTORY', () => {
    setLastActiveSession('sess-4')
    const many = Array.from({ length: MAX_KEYWORD_HISTORY + 10 }, (_, i) => `kw${i}`)
    pushKeywords('sess-4', many)
    const state = getSessionState('sess-4')
    expect(state!.keywords.length).toBe(MAX_KEYWORD_HISTORY)
    // Most recent keywords win
    expect(state!.keywords[state!.keywords.length - 1]).toBe(
      `kw${MAX_KEYWORD_HISTORY + 9}`,
    )
  })

  it('resetSessionState clears both the active pointer and the map', () => {
    setLastActiveSession('sess-5')
    pushToolName('sess-5', 'Read')
    resetSessionState()
    expect(getLastActiveSession()).toBeUndefined()
    expect(getSessionState('sess-5')).toBeUndefined()
  })

  it('pushToolName on an unseen session initialises its state entry', () => {
    pushToolName('fresh-session', 'Grep')
    const state = getSessionState('fresh-session')
    expect(state!.toolNames).toEqual(['Grep'])
    expect(state!.toolCount).toBe(1)
    expect(state!.keywords).toEqual([])
  })
})
