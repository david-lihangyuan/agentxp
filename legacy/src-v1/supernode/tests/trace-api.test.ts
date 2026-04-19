// trace-api.test.ts — L2 Trace API Tests
// Tests for: computeTransferabilityScore, detectConflictingTraces,
//            submitFeedback, getFeedbackStats, deprecateExperience,
//            applyPubkeyLimit, enrichWithTrace, buildTraceFilterConditions

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  computeTransferabilityScore,
  detectConflictingTraces,
  submitFeedback,
  getFeedbackStats,
  deprecateExperience,
  applyPubkeyLimit,
  enrichWithTrace,
  buildTraceFilterConditions,
  PUBKEY_RESULT_LIMIT,
} from '../src/agentxp/trace-api'

// ─────────────────────────────────────────────────────────────────────────────
// In-memory DB setup helper
// ─────────────────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:')

  // Minimal experiences table with L2 trace columns
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL DEFAULT '',
      pubkey TEXT NOT NULL DEFAULT '',
      operator_pubkey TEXT NOT NULL DEFAULT '',
      what TEXT NOT NULL DEFAULT '',
      tried TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      learned TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'public',
      scope TEXT,
      is_failure INTEGER NOT NULL DEFAULT 0,
      embedding TEXT,
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER,
      reasoning_trace TEXT,
      question_id TEXT,
      parent_trace_id TEXT,
      trace_worthiness TEXT DEFAULT 'low',
      domain_ecosystem TEXT,
      domain_layer TEXT,
      reproducibility TEXT,
      deprecated_at INTEGER,
      deprecated_by TEXT
    )
  `)

  // Feedback table
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      experience_id INTEGER REFERENCES experiences(id),
      consumer_pubkey TEXT NOT NULL,
      applied BOOLEAN NOT NULL DEFAULT 0,
      outcome TEXT CHECK(outcome IN ('success', 'partial', 'failed')),
      notes TEXT,
      transferability_perceived REAL,
      created_at INTEGER NOT NULL,
      UNIQUE(trace_id, consumer_pubkey)
    )
  `)

  // Trace references table
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_experience_id INTEGER NOT NULL REFERENCES experiences(id),
      referenced_experience_id INTEGER NOT NULL REFERENCES experiences(id),
      step_index INTEGER,
      stale BOOLEAN NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `)

  return db
}

function insertExperience(
  db: Database.Database,
  opts: {
    pubkey?: string
    outcome?: string
    learned?: string
    question_id?: string
    deprecated_at?: number | null
    deprecated_by?: string | null
    reasoning_trace?: string | null
    trace_worthiness?: string
  } = {}
): number {
  const now = Math.floor(Date.now() / 1000)
  const res = db
    .prepare(
      `INSERT INTO experiences
         (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility,
          embedding_status, created_at, question_id, deprecated_at, deprecated_by, reasoning_trace, trace_worthiness)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `evt-${Math.random()}`,
      opts.pubkey ?? 'pubkey-test',
      'op-test',
      'what text',
      'tried text',
      opts.outcome ?? 'succeeded',
      opts.learned ?? 'learned something',
      '[]',
      'public',
      'indexed',
      now,
      opts.question_id ?? null,
      opts.deprecated_at ?? null,
      opts.deprecated_by ?? null,
      opts.reasoning_trace ?? null,
      opts.trace_worthiness ?? 'low'
    )
  return res.lastInsertRowid as number
}

// ─────────────────────────────────────────────────────────────────────────────
// computeTransferabilityScore
// ─────────────────────────────────────────────────────────────────────────────

describe('computeTransferabilityScore', () => {
  it('returns 1.0 when no prereqs and no domain (perfect vacuum match)', () => {
    const score = computeTransferabilityScore([], [], { tools_required: [], environment: [] }, {
      languages: [],
      frameworks: [],
    })
    expect(score).toBe(1.0)
  })

  it('returns 1.0 when consumer fully satisfies all tools and env requirements', () => {
    const score = computeTransferabilityScore(
      ['docker', 'kubectl'],
      ['linux', 'k8s'],
      { tools_required: ['docker', 'kubectl'], environment: ['linux', 'k8s'] },
      { languages: [], frameworks: [] }
    )
    expect(score).toBeCloseTo(1.0)
  })

  it('returns 0.0 when nothing matches', () => {
    const score = computeTransferabilityScore(
      ['photoshop'],
      ['macos'],
      { tools_required: ['docker', 'kubectl'], environment: ['linux'] },
      { languages: ['python'], frameworks: ['fastapi'] }
    )
    expect(score).toBe(0.0)
  })

  it('returns partial score when only tools match (not env)', () => {
    const score = computeTransferabilityScore(
      ['docker'],
      [],
      { tools_required: ['docker'], environment: ['linux', 'k8s'] },
      { languages: [], frameworks: [] }
    )
    // tools: 1/1 * 0.5 = 0.5, env: 0/2 * 0.3 = 0, domain: 1.0 * 0.2 = 0.2
    expect(score).toBeCloseTo(0.7)
  })

  it('returns partial score when only env matches (not tools)', () => {
    const score = computeTransferabilityScore(
      [],
      ['linux'],
      { tools_required: ['docker'], environment: ['linux'] },
      { languages: [], frameworks: [] }
    )
    // tools: 0/1 * 0.5 = 0, env: 1/1 * 0.3 = 0.3, domain: 1.0 * 0.2 = 0.2
    expect(score).toBeCloseTo(0.5)
  })

  it('partial domain match contributes fractionally', () => {
    const score = computeTransferabilityScore(
      ['python'],
      [],
      { tools_required: [], environment: [] },
      { languages: ['python', 'javascript'], frameworks: [] }
    )
    // tools: 1.0*0.5, env: 1.0*0.3, domain: 1/2 * 0.2 = 0.1
    expect(score).toBeCloseTo(0.9)
  })

  it('is case-insensitive', () => {
    const score = computeTransferabilityScore(
      ['Docker'],
      ['Linux'],
      { tools_required: ['docker'], environment: ['linux'] },
      { languages: [], frameworks: [] }
    )
    expect(score).toBeCloseTo(1.0)
  })

  it('clamps result to [0, 1]', () => {
    const score = computeTransferabilityScore(
      ['a', 'b', 'c', 'd'],
      ['x', 'y', 'z'],
      { tools_required: ['a'], environment: ['x'] },
      { languages: ['c'], frameworks: [] }
    )
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectConflictingTraces
// ─────────────────────────────────────────────────────────────────────────────

describe('detectConflictingTraces', () => {
  it('returns false for empty array', () => {
    expect(detectConflictingTraces('q1', [])).toBe(false)
  })

  it('returns false for single experience with matching question_id', () => {
    const exps = [{ question_id: 'q1', outcome: 'succeeded', learned: 'lesson A' }]
    expect(detectConflictingTraces('q1', exps)).toBe(false)
  })

  it('returns false when two experiences have same outcome and learned', () => {
    const exps = [
      { question_id: 'q1', outcome: 'succeeded', learned: 'same lesson' },
      { question_id: 'q1', outcome: 'succeeded', learned: 'same lesson' },
    ]
    expect(detectConflictingTraces('q1', exps)).toBe(false)
  })

  it('returns true when two experiences have different outcomes', () => {
    const exps = [
      { question_id: 'q1', outcome: 'succeeded', learned: 'restart works' },
      { question_id: 'q1', outcome: 'failed', learned: 'restart works' },
    ]
    expect(detectConflictingTraces('q1', exps)).toBe(true)
  })

  it('returns true when two experiences have same outcome but different learned', () => {
    const exps = [
      { question_id: 'q1', outcome: 'succeeded', learned: 'restart clears cache' },
      { question_id: 'q1', outcome: 'succeeded', learned: 'rebuild image is the fix' },
    ]
    expect(detectConflictingTraces('q1', exps)).toBe(true)
  })

  it('ignores experiences with different question_id', () => {
    const exps = [
      { question_id: 'q1', outcome: 'succeeded', learned: 'lesson A' },
      { question_id: 'q2', outcome: 'failed', learned: 'lesson B' },
    ]
    // Only q1 is considered; only 1 experience with q1 -> no conflict
    expect(detectConflictingTraces('q1', exps)).toBe(false)
  })

  it('returns false for empty questionId', () => {
    const exps = [
      { question_id: 'q1', outcome: 'succeeded', learned: 'A' },
      { question_id: 'q1', outcome: 'failed', learned: 'B' },
    ]
    expect(detectConflictingTraces('', exps)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// submitFeedback
// ─────────────────────────────────────────────────────────────────────────────

describe('submitFeedback', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('submits feedback successfully', async () => {
    const result = await submitFeedback(db, {
      trace_id: 'trace-001',
      consumer_pubkey: 'pk-alice',
      applied: true,
      outcome: 'success',
      notes: 'worked great',
      transferability_perceived: 0.9,
    })
    expect(result.ok).toBe(true)
    expect(result.id).toBeTypeOf('number')
  })

  it('stores correct data in DB', async () => {
    await submitFeedback(db, {
      trace_id: 'trace-002',
      consumer_pubkey: 'pk-bob',
      applied: false,
      outcome: 'partial',
    })
    const row = db.prepare('SELECT * FROM trace_feedback WHERE trace_id = ?').get('trace-002') as
      | {
          outcome: string
          applied: number
          transferability_perceived: number | null
          notes: string | null
        }
      | undefined
    expect(row).toBeDefined()
    expect(row?.outcome).toBe('partial')
    expect(row?.applied).toBe(0)
    expect(row?.transferability_perceived).toBeNull()
    expect(row?.notes).toBeNull()
  })

  it('rejects duplicate submission (UNIQUE constraint: same trace_id + consumer_pubkey)', async () => {
    await submitFeedback(db, {
      trace_id: 'trace-dup',
      consumer_pubkey: 'pk-carol',
      applied: true,
      outcome: 'success',
    })
    const second = await submitFeedback(db, {
      trace_id: 'trace-dup',
      consumer_pubkey: 'pk-carol',
      applied: false,
      outcome: 'failed',
    })
    expect(second.ok).toBe(false)
    expect(second.error).toContain('duplicate')
  })

  it('allows same consumer to submit feedback on different traces', async () => {
    const r1 = await submitFeedback(db, {
      trace_id: 'trace-A',
      consumer_pubkey: 'pk-dave',
      applied: true,
      outcome: 'success',
    })
    const r2 = await submitFeedback(db, {
      trace_id: 'trace-B',
      consumer_pubkey: 'pk-dave',
      applied: true,
      outcome: 'failed',
    })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })

  it('allows different consumers to submit feedback on same trace', async () => {
    const r1 = await submitFeedback(db, {
      trace_id: 'trace-shared',
      consumer_pubkey: 'pk-user1',
      applied: true,
      outcome: 'success',
    })
    const r2 = await submitFeedback(db, {
      trace_id: 'trace-shared',
      consumer_pubkey: 'pk-user2',
      applied: true,
      outcome: 'partial',
    })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })

  it('handles all outcome types', async () => {
    for (const [i, outcome] of (['success', 'partial', 'failed'] as const).entries()) {
      const result = await submitFeedback(db, {
        trace_id: `trace-outcome-${i}`,
        consumer_pubkey: 'pk-test',
        applied: true,
        outcome,
      })
      expect(result.ok).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getFeedbackStats
// ─────────────────────────────────────────────────────────────────────────────

describe('getFeedbackStats', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('returns zeroes for a trace with no feedback', async () => {
    const stats = await getFeedbackStats(db, 'trace-empty')
    expect(stats.total).toBe(0)
    expect(stats.success).toBe(0)
    expect(stats.partial).toBe(0)
    expect(stats.failed).toBe(0)
    expect(stats.avg_transferability).toBeNull()
  })

  it('counts outcomes correctly', async () => {
    const tid = 'trace-count'
    await submitFeedback(db, { trace_id: tid, consumer_pubkey: 'pk-1', applied: true, outcome: 'success' })
    await submitFeedback(db, { trace_id: tid, consumer_pubkey: 'pk-2', applied: true, outcome: 'success' })
    await submitFeedback(db, { trace_id: tid, consumer_pubkey: 'pk-3', applied: false, outcome: 'partial' })
    await submitFeedback(db, { trace_id: tid, consumer_pubkey: 'pk-4', applied: false, outcome: 'failed' })

    const stats = await getFeedbackStats(db, tid)
    expect(stats.total).toBe(4)
    expect(stats.success).toBe(2)
    expect(stats.partial).toBe(1)
    expect(stats.failed).toBe(1)
  })

  it('computes avg_transferability correctly', async () => {
    const tid = 'trace-avg'
    await submitFeedback(db, {
      trace_id: tid,
      consumer_pubkey: 'pk-a',
      applied: true,
      outcome: 'success',
      transferability_perceived: 0.8,
    })
    await submitFeedback(db, {
      trace_id: tid,
      consumer_pubkey: 'pk-b',
      applied: true,
      outcome: 'partial',
      transferability_perceived: 0.4,
    })

    const stats = await getFeedbackStats(db, tid)
    expect(stats.total).toBe(2)
    expect(stats.avg_transferability).toBeCloseTo(0.6)
  })

  it('avg_transferability is null when no perceived values submitted', async () => {
    const tid = 'trace-no-perc'
    await submitFeedback(db, {
      trace_id: tid,
      consumer_pubkey: 'pk-x',
      applied: false,
      outcome: 'failed',
    })
    const stats = await getFeedbackStats(db, tid)
    expect(stats.avg_transferability).toBeNull()
  })

  it('isolates stats per trace_id', async () => {
    await submitFeedback(db, { trace_id: 'trace-iso-1', consumer_pubkey: 'pk-1', applied: true, outcome: 'success' })
    await submitFeedback(db, { trace_id: 'trace-iso-2', consumer_pubkey: 'pk-1', applied: true, outcome: 'failed' })

    const s1 = await getFeedbackStats(db, 'trace-iso-1')
    const s2 = await getFeedbackStats(db, 'trace-iso-2')
    expect(s1.success).toBe(1)
    expect(s1.failed).toBe(0)
    expect(s2.success).toBe(0)
    expect(s2.failed).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// deprecateExperience
// ─────────────────────────────────────────────────────────────────────────────

describe('deprecateExperience', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('marks an experience as deprecated', async () => {
    const id = insertExperience(db)
    const result = await deprecateExperience(db, id, 'admin-key')
    expect(result.ok).toBe(true)

    const row = db.prepare('SELECT deprecated_at, deprecated_by FROM experiences WHERE id = ?').get(id) as
      | { deprecated_at: number | null; deprecated_by: string | null }
      | undefined
    expect(row?.deprecated_at).toBeTypeOf('number')
    expect(row?.deprecated_by).toBe('admin-key')
  })

  it('returns error for non-existent experience', async () => {
    const result = await deprecateExperience(db, 9999, 'admin')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('marks stale references when deprecating', async () => {
    const expId = insertExperience(db)
    const sourceId = insertExperience(db)

    const now = Math.floor(Date.now() / 1000)
    // Insert a trace_reference pointing to expId
    db.prepare(
      `INSERT INTO trace_references (source_experience_id, referenced_experience_id, stale, created_at)
       VALUES (?, ?, 0, ?)`
    ).run(sourceId, expId, now)

    const result = await deprecateExperience(db, expId, 'mod-key')
    expect(result.ok).toBe(true)
    expect(result.stale_references_updated).toBe(1)

    const ref = db
      .prepare('SELECT stale FROM trace_references WHERE referenced_experience_id = ?')
      .get(expId) as { stale: number } | undefined
    expect(ref?.stale).toBe(1)
  })

  it('does not double-mark already-stale references', async () => {
    const expId = insertExperience(db)
    const sourceId = insertExperience(db)
    const now = Math.floor(Date.now() / 1000)

    db.prepare(
      `INSERT INTO trace_references (source_experience_id, referenced_experience_id, stale, created_at)
       VALUES (?, ?, 1, ?)`
    ).run(sourceId, expId, now)

    const result = await deprecateExperience(db, expId, 'mod')
    expect(result.ok).toBe(true)
    expect(result.stale_references_updated).toBe(0)
  })

  it('marks multiple stale references', async () => {
    const expId = insertExperience(db)
    const now = Math.floor(Date.now() / 1000)

    for (let i = 0; i < 3; i++) {
      const srcId = insertExperience(db)
      db.prepare(
        `INSERT INTO trace_references (source_experience_id, referenced_experience_id, stale, created_at)
         VALUES (?, ?, 0, ?)`
      ).run(srcId, expId, now)
    }

    const result = await deprecateExperience(db, expId, 'admin')
    expect(result.ok).toBe(true)
    expect(result.stale_references_updated).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyPubkeyLimit (#5)
// ─────────────────────────────────────────────────────────────────────────────

describe('applyPubkeyLimit', () => {
  it('passes through results when each pubkey has fewer than limit results', () => {
    const results = [
      { pubkey: 'pk-1' },
      { pubkey: 'pk-2' },
      { pubkey: 'pk-3' },
    ]
    const out = applyPubkeyLimit(results)
    expect(out.length).toBe(3)
  })

  it(`limits single pubkey to ${PUBKEY_RESULT_LIMIT} results`, () => {
    const results = Array.from({ length: 8 }, (_, i) => ({ pubkey: 'pk-same', id: i }))
    const out = applyPubkeyLimit(results)
    expect(out.length).toBe(PUBKEY_RESULT_LIMIT)
    expect(out.every((r) => r.pubkey === 'pk-same')).toBe(true)
  })

  it('allows different pubkeys to each have up to limit results', () => {
    const results = [
      ...Array.from({ length: 5 }, () => ({ pubkey: 'pk-a' })),
      ...Array.from({ length: 5 }, () => ({ pubkey: 'pk-b' })),
    ]
    const out = applyPubkeyLimit(results)
    expect(out.length).toBe(10)
  })

  it('truncates excess results from same pubkey beyond limit', () => {
    const results = [
      ...Array.from({ length: 7 }, (_, i) => ({ pubkey: 'pk-x', seq: i })),
      { pubkey: 'pk-y' },
    ]
    const out = applyPubkeyLimit(results)
    // pk-x contributes max 5, pk-y contributes 1
    expect(out.filter((r) => r.pubkey === 'pk-x').length).toBe(PUBKEY_RESULT_LIMIT)
    expect(out.filter((r) => r.pubkey === 'pk-y').length).toBe(1)
    expect(out.length).toBe(PUBKEY_RESULT_LIMIT + 1)
  })

  it('custom limit overrides default', () => {
    const results = Array.from({ length: 10 }, () => ({ pubkey: 'pk-custom' }))
    const out = applyPubkeyLimit(results, 3)
    expect(out.length).toBe(3)
  })

  it('handles empty array', () => {
    expect(applyPubkeyLimit([])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// enrichWithTrace
// ─────────────────────────────────────────────────────────────────────────────

describe('enrichWithTrace', () => {
  it('returns null trace_summary when no reasoning_trace', () => {
    const exp = { reasoning_trace: null, question_id: null }
    const result = enrichWithTrace(exp, {}, [exp])
    expect(result.trace_summary).toBeNull()
  })

  it('extracts trace_summary from reasoning_trace JSON', () => {
    const trace = JSON.stringify({ summary: 'Docker DNS fix summary', context_at_start: {} })
    const exp = { reasoning_trace: trace, question_id: null }
    const result = enrichWithTrace(exp, {}, [exp])
    expect(result.trace_summary).toBe('Docker DNS fix summary')
  })

  it('does not include reasoning_trace by default', () => {
    const trace = JSON.stringify({ summary: 'S' })
    const exp = { reasoning_trace: trace, question_id: null }
    const result = enrichWithTrace(exp, { include_trace: false }, [exp])
    expect(result.reasoning_trace).toBeUndefined()
  })

  it('includes reasoning_trace when include_trace=true', () => {
    const parsedTrace = { summary: 'S', steps: [1, 2, 3] }
    const exp = { reasoning_trace: JSON.stringify(parsedTrace), question_id: null }
    const result = enrichWithTrace(exp, { include_trace: true }, [exp])
    expect(result.reasoning_trace).toEqual(parsedTrace)
  })

  it('includes context_at_start when include_context=true', () => {
    const parsedTrace = { summary: 'S', context_at_start: { env: 'prod', version: '1.0' } }
    const exp = { reasoning_trace: JSON.stringify(parsedTrace), question_id: null }
    const result = enrichWithTrace(exp, { include_context: true }, [exp])
    expect(result.context_at_start).toEqual({ env: 'prod', version: '1.0' })
  })

  it('sets conflicting_traces=false when no question_id', () => {
    const exp = { reasoning_trace: null, question_id: null }
    const result = enrichWithTrace(exp, {}, [exp])
    expect(result.conflicting_traces).toBe(false)
  })

  it('sets conflicting_traces=true when same question_id has different outcomes', () => {
    const exp1 = { reasoning_trace: null, question_id: 'q-conflict', outcome: 'succeeded', learned: 'A' }
    const exp2 = { reasoning_trace: null, question_id: 'q-conflict', outcome: 'failed', learned: 'B' }
    const result = enrichWithTrace(exp1, {}, [exp1, exp2])
    expect(result.conflicting_traces).toBe(true)
  })

  it('computes transferability_score when consumer context is provided', () => {
    const parsedTrace = {
      summary: 'S',
      prerequisites: { tools_required: ['docker'], environment: ['linux'] },
      domain_fingerprint: { languages: [], frameworks: [] },
    }
    const exp = { reasoning_trace: JSON.stringify(parsedTrace), question_id: null }
    const result = enrichWithTrace(
      exp,
      { consumer_tools: ['docker'], consumer_env: ['linux'] },
      [exp]
    )
    expect(result.transferability_score).toBeTypeOf('number')
    expect(result.transferability_score).toBeCloseTo(1.0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildTraceFilterConditions
// ─────────────────────────────────────────────────────────────────────────────

describe('buildTraceFilterConditions', () => {
  it('excludes deprecated by default', () => {
    const { conditions } = buildTraceFilterConditions({})
    expect(conditions).toContain('e.deprecated_at IS NULL')
  })

  it('does not exclude deprecated when exclude_deprecated=false', () => {
    const { conditions } = buildTraceFilterConditions({ exclude_deprecated: false })
    expect(conditions).not.toContain('e.deprecated_at IS NULL')
  })

  it('adds worthiness filter for high', () => {
    const { conditions } = buildTraceFilterConditions({ min_worthiness: 'high' })
    expect(conditions.some((c) => c.includes('high'))).toBe(true)
  })

  it('no worthiness filter for low', () => {
    const { conditions } = buildTraceFilterConditions({ min_worthiness: 'low' })
    expect(conditions.some((c) => c.includes('trace_worthiness'))).toBe(false)
  })
})
