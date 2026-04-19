// MemoryPromptSectionBuilder contract (M7 Batch 2). The builder
// is synchronous and has no session parameter, so it reads the
// last-active session from the shared session-state module. The
// output is markdown lines for the host to splice into the system
// prompt under "## Past AgentXP Experiences".
import { describe, it, expect, beforeEach } from 'vitest'
import { openPluginDb, type PluginDb } from '../src/db.js'
import { createPromptBuilder } from '../src/memory-prompt.js'
import {
  resetSessionState,
  setLastActiveSession,
  pushKeywords,
  pushToolName,
} from '../src/session-state.js'

function stage(
  db: PluginDb,
  opts: { sessionId: string; what: string; tags?: string[]; tried?: string; learned?: string },
): void {
  const now = Math.floor(Date.now() / 1000)
  db.stageExperience({
    session_id: opts.sessionId,
    reason: 'exit',
    data_json: JSON.stringify({
      what: opts.what,
      tried: opts.tried ?? 'tried',
      outcome: 'succeeded',
      learned: opts.learned ?? 'learned',
    }),
    trace_json: JSON.stringify({ steps: [] }),
    tags_json: JSON.stringify(opts.tags ?? []),
    created_at: now,
    next_attempt_at: now,
  })
}

describe('memory-prompt · createPromptBuilder', () => {
  beforeEach(() => {
    resetSessionState()
  })

  it('returns [] when there is no active session', () => {
    const db = openPluginDb(':memory:')
    try {
      const builder = createPromptBuilder(db)
      expect(builder({ availableTools: new Set() })).toEqual([])
    } finally {
      db.close()
    }
  })

  it('returns [] when the active session has no keywords', () => {
    const db = openPluginDb(':memory:')
    try {
      stage(db, { sessionId: 'sX', what: 'anything', tags: ['anything'] })
      setLastActiveSession('sX')
      const builder = createPromptBuilder(db)
      expect(builder({ availableTools: new Set() })).toEqual([])
    } finally {
      db.close()
    }
  })

  it('returns [] when keywords produce zero corpus hits', () => {
    const db = openPluginDb(':memory:')
    try {
      stage(db, { sessionId: 's1', what: 'webpack bundling', tags: ['webpack'] })
      setLastActiveSession('s2')
      pushKeywords('s2', ['completely', 'unrelated'])
      const builder = createPromptBuilder(db)
      expect(builder({ availableTools: new Set() })).toEqual([])
    } finally {
      db.close()
    }
  })

  it('emits the "## Past AgentXP Experiences" header and a bullet per hit', () => {
    const db = openPluginDb(':memory:')
    try {
      stage(db, {
        sessionId: 's1',
        what: 'debug flaky test',
        tags: ['vitest', 'flaky'],
        learned: 'isolate ports per worker',
      })
      stage(db, {
        sessionId: 's2',
        what: 'fix vitest watcher loop',
        tags: ['vitest'],
        learned: 'exclude dist from watcher',
      })
      setLastActiveSession('sA')
      pushKeywords('sA', ['vitest', 'flaky'])
      const builder = createPromptBuilder(db)
      const out = builder({ availableTools: new Set() })
      expect(out[0]).toBe('## Past AgentXP Experiences')
      expect(out.some((l) => l.startsWith('- '))).toBe(true)
      expect(out.some((l) => l.includes('debug flaky test'))).toBe(true)
    } finally {
      db.close()
    }
  })

  it('tailors the phase hint based on recent tool count and keywords', () => {
    const db = openPluginDb(':memory:')
    try {
      stage(db, { sessionId: 's1', what: 'debug failing pipeline', tags: ['pipeline'] })
      setLastActiveSession('sP')
      // Six tool calls + "error" keyword → stuck phase
      for (let i = 0; i < 6; i++) pushToolName('sP', `t${i}`)
      pushKeywords('sP', ['error', 'pipeline'])
      const builder = createPromptBuilder(db)
      const out = builder({ availableTools: new Set() })
      const joined = out.join('\n').toLowerCase()
      expect(joined).toContain('stuck')
    } finally {
      db.close()
    }
  })

  it('respects a maxResults cap (default 3) even when many rows match', () => {
    const db = openPluginDb(':memory:')
    try {
      for (let i = 0; i < 10; i++) {
        stage(db, { sessionId: `row${i}`, what: `story ${i}`, tags: ['alpha'] })
      }
      setLastActiveSession('sC')
      pushKeywords('sC', ['alpha'])
      const builder = createPromptBuilder(db)
      const out = builder({ availableTools: new Set() })
      const bullets = out.filter((l) => l.startsWith('- '))
      expect(bullets.length).toBeLessThanOrEqual(3)
      expect(bullets.length).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })
})
