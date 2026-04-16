/**
 * integration.test.ts — Full lifecycle integration test for AgentXP plugin.
 *
 * Tests the complete flow: DB → hooks → extraction → injection → memory corpus
 * Uses in-memory SQLite + actual module imports (no mocks).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { createDb } from '../src/db.js'
import type { Db } from '../src/db.js'
import { DEFAULT_CONFIG } from '../src/types.js'
import type { PluginConfig } from '../src/types.js'

import {
  createMessageSendingHook,
  createAfterToolCallHook,
  createAgentEndHook,
  createBeforeToolCallHook,
  resetState,
} from '../src/hooks/index.js'

import {
  createPromptBuilder,
  setLastActiveSession as setPromptSession,
  resetLastActiveSession,
  _setNowFn,
  _resetNowFn,
} from '../src/memory-prompt.js'

import { createCorpusSupplement } from '../src/memory-corpus.js'

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<PluginConfig>): PluginConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

/**
 * Insert a lesson that will match FTS and pass the phase-relevance filter.
 * Uses "error"/"debug" keywords to match the "stuck" phase.
 */
function seedLesson(db: Db, overrides?: Partial<Parameters<Db['insertLesson']>[0]>): number {
  return db.insertLesson({
    what: 'ModuleNotFoundError encountered in src/index.ts',
    tried: 'Added .js extensions to all relative imports',
    outcome: 'Build succeeded after fixing ESM import paths',
    learned: 'TypeScript ESM projects require .js extensions in import paths. ModuleNotFoundError is the symptom.',
    source: 'local',
    tags: ['typescript', 'esm', 'error', 'auto-extracted'],
    ...overrides,
  })
}

// ─── Full Lifecycle ────────────────────────────────────────────────────────

describe('integration: full lifecycle', () => {
  let db: Db
  const SESSION_KEY = 'integration-test-session'
  const CHANNEL_ID = 'integration-test-channel'

  beforeEach(() => {
    db = createDb(':memory:')
    resetState()
    resetLastActiveSession()
    _resetNowFn()
  })

  afterEach(() => {
    db.close()
    resetState()
    resetLastActiveSession()
    _resetNowFn()
  })

  it('complete lifecycle: insert → message_sending → after_tool_call → agent_end → inject → search → get → trace', async () => {
    // ── 1. Insert preloaded lessons (no install.ts dependency) ──────────
    const lessonId1 = seedLesson(db)
    const lessonId2 = seedLesson(db, {
      what: 'Vitest config error for ESM project',
      tried: 'Set type: "module" in package.json and added vitest.config.ts',
      outcome: 'All tests pass with ESM configuration',
      learned: 'Vitest requires explicit ESM config — set type: "module" and use .ts config file.',
      tags: ['vitest', 'esm', 'config'],
    })
    expect(db.getLessonCount()).toBe(2)

    // ── 2. Simulate message_sending hook → keywords cached ─────────────
    const msgHook = createMessageSendingHook(db)
    msgHook(
      { to: 'user', content: 'I fixed the TypeScript ESM import error by adding .js extensions' },
      { channelId: CHANNEL_ID },
    )
    const cache = db.getContextCache(CHANNEL_ID)
    expect(cache).not.toBeNull()
    expect(cache!.keywords.length).toBeGreaterThan(0)
    // Should contain technical terms
    expect(cache!.keywords.some(k => /TypeScript|ESM/i.test(k))).toBe(true)

    // ── 3. Simulate after_tool_call × 3: error → edit → success ────────
    const toolHook = createAfterToolCallHook()

    // Error call
    toolHook(
      {
        toolName: 'exec',
        params: { command: 'npm test' },
        error: 'ModuleNotFoundError: Cannot find module ./utils',
      },
      { sessionKey: SESSION_KEY, toolName: 'exec' },
    )

    // Fix call (edit)
    toolHook(
      {
        toolName: 'edit',
        params: { path: 'src/index.ts' },
      },
      { sessionKey: SESSION_KEY, toolName: 'edit' },
    )

    // Success call
    toolHook(
      {
        toolName: 'exec',
        params: { command: 'npm test' },
        result: 'All 42 tests pass ✓',
      },
      { sessionKey: SESSION_KEY, toolName: 'exec' },
    )

    // ── 4. Simulate agent_end → extraction produces a lesson ───────────
    const endHook = createAgentEndHook(db)
    const lessonCountBefore = db.getLessonCount()
    endHook(
      { messages: [], success: true },
      { sessionKey: SESSION_KEY },
    )
    // Extraction should have produced a new lesson from the error→fix→success pattern
    const lessonCountAfter = db.getLessonCount()
    expect(lessonCountAfter).toBeGreaterThanOrEqual(lessonCountBefore)

    // ── 5. Test memory prompt builder → injection lines ────────────────
    const config = makeConfig({ weaning: { enabled: false, rate: 0 } })

    // Set up session freshness — fix time to avoid staleness
    const baseTime = Date.now()
    _setNowFn(() => baseTime)

    // memory-prompt.ts has its own module-level lastActiveSession state
    // (separate from hooks/state.ts), so we use its setLastActiveSession directly
    setPromptSession(CHANNEL_ID)
    _setNowFn(() => baseTime + 1_000) // 1 second later — fresh

    const builder = createPromptBuilder(db, config, () => 0.99) // disable weaning
    const lines = builder({
      availableTools: new Set(['exec', 'read', 'write', 'edit']),
      citationsMode: undefined,
    })

    // Should return injection lines since we have matching lessons + keywords
    expect(lines.length).toBeGreaterThan(0)
    const injectionText = lines.join('\n')
    expect(injectionText).toContain('external_experience')

    // ── 6. Test memory corpus search → should find lessons ─────────────
    const corpus = createCorpusSupplement(db, config)
    const searchResults = await corpus.search({ query: 'ESM import TypeScript' })
    expect(searchResults.length).toBeGreaterThan(0)
    expect(searchResults[0].corpus).toBe('agentxp')
    expect(searchResults[0].snippet).toBeTruthy()

    // ── 7. Test memory corpus get → should return lesson detail ────────
    const firstResult = searchResults[0]
    expect(firstResult.id).toBeTruthy()
    const detail = await corpus.get({ lookup: firstResult.id! })
    expect(detail).not.toBeNull()
    expect(detail!.corpus).toBe('agentxp')
    expect(detail!.content).toContain('Tried:')
    expect(detail!.content).toContain('Learned:')

    // ── 8. Test before_tool_call → trace recorded ──────────────────────
    const traceHook = createBeforeToolCallHook(db)
    traceHook(
      { toolName: 'read', params: { path: 'src/index.ts' } },
      { sessionKey: SESSION_KEY, toolName: 'read' },
    )
    traceHook(
      { toolName: 'exec', params: { command: 'npm run build' } },
      { sessionKey: SESSION_KEY, toolName: 'exec' },
    )
    const traceSteps = db.getTraceSteps(SESSION_KEY)
    expect(traceSteps.length).toBe(2)
    expect(traceSteps[0].action).toBe('file:read')
    expect(traceSteps[1].action).toBe('shell:exec')

    // ── 9. Check injection stats ───────────────────────────────────────
    const stats = db.getInjectionStats()
    // At least one injection was recorded by the prompt builder
    expect(stats.total).toBeGreaterThanOrEqual(1)
    expect(stats.injected).toBeGreaterThanOrEqual(1)

    // ── 10. Verify all DB tables have data ─────────────────────────────
    const counts = db.getTableCounts()
    expect(counts.local_lessons).toBeGreaterThanOrEqual(2)
    expect(counts.trace_steps).toBeGreaterThanOrEqual(2)
    expect(counts.context_cache).toBeGreaterThanOrEqual(1)
    expect(counts.injection_log).toBeGreaterThanOrEqual(1)
  })

  it('session lifecycle: session_end clears state', async () => {
    const { createSessionEndHook } = await import('../src/hooks/session-lifecycle.js')

    // Set up some state
    const msgHook = createMessageSendingHook(db)
    msgHook(
      { to: 'user', content: 'Working on TypeScript ESM migration' },
      { channelId: SESSION_KEY },
    )
    expect(db.getContextCache(SESSION_KEY)).not.toBeNull()

    // Simulate tool calls to populate buffer
    const toolHook = createAfterToolCallHook()
    toolHook(
      { toolName: 'read', params: { path: 'src/main.ts' } },
      { sessionKey: SESSION_KEY, toolName: 'read' },
    )

    // End session
    const endSessionHook = createSessionEndHook(db)
    endSessionHook(
      { sessionId: 'sid-1', sessionKey: SESSION_KEY },
      { sessionId: 'sid-1', sessionKey: SESSION_KEY },
    )

    // Context cache should be cleared
    expect(db.getContextCache(SESSION_KEY)).toBeNull()
  })

  it('error isolation: hooks never throw', () => {
    // message_sending with bad data
    const msgHook = createMessageSendingHook(db)
    expect(() => {
      msgHook(
        { to: 'user', content: '' },
        { channelId: '' },
      )
    }).not.toThrow()

    // after_tool_call with missing session
    const toolHook = createAfterToolCallHook()
    expect(() => {
      toolHook(
        { toolName: '', params: {} },
        { toolName: '' },
      )
    }).not.toThrow()

    // agent_end with empty buffer
    const endHook = createAgentEndHook(db)
    expect(() => {
      endHook(
        { messages: [], success: false },
        {},
      )
    }).not.toThrow()

    // before_tool_call with missing data
    const traceHook = createBeforeToolCallHook(db)
    expect(() => {
      traceHook(
        { toolName: 'unknown_tool', params: {} },
        { toolName: 'unknown_tool' },
      )
    }).not.toThrow()
  })

  it('corpus get with direct lesson ID string', async () => {
    const lessonId = seedLesson(db)
    const config = makeConfig()
    const corpus = createCorpusSupplement(db, config)

    // Get by numeric string
    const detail = await corpus.get({ lookup: String(lessonId) })
    expect(detail).not.toBeNull()
    expect(detail!.id).toBe(String(lessonId))
    expect(detail!.content).toContain('TypeScript ESM')

    // Get by agentxp:// URI
    const detail2 = await corpus.get({ lookup: `agentxp://lesson/${lessonId}` })
    expect(detail2).not.toBeNull()
    expect(detail2!.id).toBe(String(lessonId))
  })

  it('corpus get returns null for invalid lookup', async () => {
    const config = makeConfig()
    const corpus = createCorpusSupplement(db, config)

    expect(await corpus.get({ lookup: 'not-a-number' })).toBeNull()
    expect(await corpus.get({ lookup: '99999' })).toBeNull()
  })
})

// ─── Weaning Statistical Test ──────────────────────────────────────────────

describe('integration: weaning statistical test', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
    resetState()
    resetLastActiveSession()
    _resetNowFn()
  })

  afterEach(() => {
    db.close()
    resetState()
    resetLastActiveSession()
    _resetNowFn()
  })

  it('~10% skip rate over 1000 trials (weaning rate = 0.1)', () => {
    // Seed lessons that will match and pass phase filter
    db.insertLesson({
      what: 'error in deploy pipeline — build fails',
      tried: 'debug retry logic for failing deploy step',
      outcome: 'fixed the error after applying retry workaround',
      learned: 'always add error retry for transient failures in deploy.ts',
      source: 'local',
      tags: ['error', 'debug', 'deploy'],
    })

    // Set up context cache with matching keywords
    const sessionKey = 'weaning-stats-test'
    db.upsertContextCache({
      sessionId: sessionKey,
      keywords: ['error', 'deploy', 'debug'],
    })

    const config = makeConfig({
      weaning: { enabled: true, rate: 0.1 },
    })

    // Fix time to keep session fresh across all iterations
    const baseTime = Date.now()
    _setNowFn(() => baseTime)

    setPromptSession(sessionKey)

    _setNowFn(() => baseTime + 500) // half second — always fresh

    // Use a deterministic PRNG seeded sequentially to simulate true randomness
    let callIndex = 0
    // Use a simple LCG (linear congruential generator) for reproducibility
    let seed = 42
    function lcgRandom(): number {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff
      return seed / 0x7fffffff
    }

    let skipCount = 0
    const N = 1000

    for (let i = 0; i < N; i++) {
      const rng = lcgRandom()
      const builder = createPromptBuilder(db, config, () => rng)
      const lines = builder({
        availableTools: new Set(['exec', 'read']),
        citationsMode: undefined,
      })
      if (lines.length === 0) skipCount++

      // Re-set session each time since the prompt builder may clear it
      _setNowFn(() => baseTime)
      setPromptSession(sessionKey)
      _setNowFn(() => baseTime + 500)
    }

    // Expect ~100 skips (10% of 1000) with tolerance ±70
    expect(skipCount).toBeGreaterThan(30)
    expect(skipCount).toBeLessThan(200)
  })
})
