// trace-schema.test.ts
// L2 Reasoning Trace — Schema & migration tests (at least 15 cases)
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db'
import type { ReasoningTrace } from '../../packages/protocol/src/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open a fresh in-memory database with all migrations applied. */
function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)
  return db
}

/** Insert a minimal experience row and return its rowid. */
function insertExperience(
  db: Database.Database,
  overrides: Record<string, unknown> = {}
): number {
  const eventId = overrides['event_id'] ?? `evt-${Math.random().toString(36).slice(2)}`
  db.prepare(`
    INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
    VALUES (?, 'pk1', 'opk1', 'intent.broadcast', 1700000000, '{}', '[]', 'public', 'sig1', 1700000000)
  `).run(eventId)

  const result = db.prepare(`
    INSERT INTO experiences (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, created_at)
    VALUES (?, 'pk1', 'opk1', 'test what', 'test tried', 'succeeded', 'test learned', 1700000000)
  `).run(eventId) as Database.RunResult

  return result.lastInsertRowid as number
}

/** A valid minimal ReasoningTrace object. */
function makeTrace(overrides: Partial<ReasoningTrace> = {}): ReasoningTrace {
  return {
    steps: [
      {
        action: 'observe',
        content: 'noticed the problem',
        significance: 'key',
      },
      {
        action: 'conclude',
        content: 'found the fix',
        significance: 'key',
      },
    ],
    dead_ends: [],
    trace_summary: 'Fixed the issue by changing config',
    confidence: 0.9,
    duration_bucket: '1_to_5min',
    tools_used_category: ['shell', 'file_ops'],
    context_at_start: 'Service was failing to start',
    prerequisites: {
      tools_required: ['shell'],
      access_level: 'user',
      environment: ['linux'],
    },
    difficulty: {
      estimated: 'easy',
      actual: 'medium',
      surprise_factor: 0.4,
    },
    domain_fingerprint: {
      ecosystem: 'docker',
      layer: 'infra',
      languages: ['bash'],
      frameworks: [],
      error_class: 'config',
    },
    trace_worthiness: 'high',
    reproducibility: 'deterministic',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('007_reasoning_trace migration', () => {
  it('TC01: migration executes without error', () => {
    expect(() => freshDb()).not.toThrow()
  })

  it('TC02: migration is idempotent (running twice does not fail)', () => {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
  })

  it('TC03: experiences table has reasoning_trace column', () => {
    const db = freshDb()
    const cols = (db.prepare('PRAGMA table_info(experiences)').all() as Array<{ name: string }>)
      .map((c) => c.name)
    expect(cols).toContain('reasoning_trace')
  })

  it('TC04: experiences table has question_id column', () => {
    const db = freshDb()
    const cols = (db.prepare('PRAGMA table_info(experiences)').all() as Array<{ name: string }>)
      .map((c) => c.name)
    expect(cols).toContain('question_id')
  })

  it('TC05: experiences table has all new L2 columns', () => {
    const db = freshDb()
    const cols = new Set(
      (db.prepare('PRAGMA table_info(experiences)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    )
    const expected = [
      'reasoning_trace',
      'question_id',
      'parent_trace_id',
      'trace_worthiness',
      'domain_ecosystem',
      'domain_layer',
      'reproducibility',
      'deprecated_at',
      'deprecated_by',
    ]
    for (const col of expected) {
      expect(cols.has(col), `column ${col} missing`).toBe(true)
    }
  })

  it('TC06: trace_feedback table exists', () => {
    const db = freshDb()
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    ).map((t) => t.name)
    expect(tables).toContain('trace_feedback')
  })

  it('TC07: trace_references table exists', () => {
    const db = freshDb()
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    ).map((t) => t.name)
    expect(tables).toContain('trace_references')
  })
})

describe('Inserting reasoning_trace JSON into experiences', () => {
  it('TC08: can insert experience with reasoning_trace JSON', () => {
    const db = freshDb()
    const expId = insertExperience(db)
    const trace = makeTrace()
    db.prepare('UPDATE experiences SET reasoning_trace = ? WHERE id = ?').run(
      JSON.stringify(trace),
      expId
    )
    const row = db.prepare('SELECT reasoning_trace FROM experiences WHERE id = ?').get(expId) as
      | { reasoning_trace: string }
      | undefined
    expect(row).toBeDefined()
    const parsed = JSON.parse(row!.reasoning_trace) as ReasoningTrace
    expect(parsed.trace_summary).toBe('Fixed the issue by changing config')
    expect(parsed.steps).toHaveLength(2)
    expect(parsed.confidence).toBe(0.9)
  })

  it('TC09: reasoning_trace can be NULL (optional field)', () => {
    const db = freshDb()
    const expId = insertExperience(db)
    const row = db.prepare('SELECT reasoning_trace FROM experiences WHERE id = ?').get(expId) as
      | { reasoning_trace: string | null }
      | undefined
    expect(row).toBeDefined()
    expect(row!.reasoning_trace).toBeNull()
  })

  it('TC10: question_id and parent_trace_id can be set and queried', () => {
    const db = freshDb()
    const expId = insertExperience(db)
    db.prepare(
      'UPDATE experiences SET question_id = ?, parent_trace_id = ? WHERE id = ?'
    ).run('q-abc-123', 'trace-parent-xyz', expId)

    const row = db
      .prepare('SELECT question_id, parent_trace_id FROM experiences WHERE question_id = ?')
      .get('q-abc-123') as { question_id: string; parent_trace_id: string } | undefined
    expect(row).toBeDefined()
    expect(row!.question_id).toBe('q-abc-123')
    expect(row!.parent_trace_id).toBe('trace-parent-xyz')
  })

  it('TC11: deprecated_at filter works', () => {
    const db = freshDb()
    const exp1 = insertExperience(db)
    const exp2 = insertExperience(db)
    db.prepare('UPDATE experiences SET deprecated_at = ? WHERE id = ?').run(1700001000, exp1)

    const active = db
      .prepare('SELECT id FROM experiences WHERE deprecated_at IS NULL')
      .all() as Array<{ id: number }>
    const activeIds = active.map((r) => r.id)
    expect(activeIds).not.toContain(exp1)
    expect(activeIds).toContain(exp2)
  })
})

describe('trace_feedback CRUD', () => {
  it('TC12: can insert a trace_feedback row', () => {
    const db = freshDb()
    const expId = insertExperience(db)
    db.prepare(`
      INSERT INTO trace_feedback (trace_id, experience_id, consumer_pubkey, applied, outcome, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('trace-001', expId, 'consumer-pk-1', 1, 'success', 1700002000)

    const row = db
      .prepare('SELECT * FROM trace_feedback WHERE trace_id = ?')
      .get('trace-001') as Record<string, unknown> | undefined
    expect(row).toBeDefined()
    expect(row!['outcome']).toBe('success')
    expect(row!['applied']).toBe(1)
  })

  it('TC13: trace_feedback UNIQUE constraint (trace_id + consumer_pubkey)', () => {
    const db = freshDb()
    const expId = insertExperience(db)
    db.prepare(`
      INSERT INTO trace_feedback (trace_id, experience_id, consumer_pubkey, applied, outcome, created_at)
      VALUES ('trace-dup', ?, 'consumer-pk-dup', 1, 'success', 1700002000)
    `).run(expId)

    expect(() => {
      db.prepare(`
        INSERT INTO trace_feedback (trace_id, experience_id, consumer_pubkey, applied, outcome, created_at)
        VALUES ('trace-dup', ?, 'consumer-pk-dup', 0, 'failed', 1700002001)
      `).run(expId)
    }).toThrow()
  })

  it('TC14: trace_feedback outcome CHECK constraint rejects invalid value', () => {
    const db = freshDb()
    const expId = insertExperience(db)
    expect(() => {
      db.prepare(`
        INSERT INTO trace_feedback (trace_id, experience_id, consumer_pubkey, applied, outcome, created_at)
        VALUES ('trace-bad', ?, 'consumer-pk-x', 1, 'unknown_value', 1700002000)
      `).run(expId)
    }).toThrow()
  })

  it('TC15: trace_feedback transferability_perceived stored as REAL', () => {
    const db = freshDb()
    const expId = insertExperience(db)
    db.prepare(`
      INSERT INTO trace_feedback (trace_id, experience_id, consumer_pubkey, applied, outcome, transferability_perceived, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('trace-real', expId, 'consumer-pk-r', 1, 'partial', 0.75, 1700002000)

    const row = db
      .prepare('SELECT transferability_perceived FROM trace_feedback WHERE trace_id = ?')
      .get('trace-real') as { transferability_perceived: number } | undefined
    expect(row).toBeDefined()
    expect(row!.transferability_perceived).toBeCloseTo(0.75)
  })
})

describe('trace_references CRUD', () => {
  it('TC16: can insert a trace_references row', () => {
    const db = freshDb()
    const src = insertExperience(db)
    const ref = insertExperience(db)
    db.prepare(`
      INSERT INTO trace_references (source_experience_id, referenced_experience_id, step_index, stale, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(src, ref, 0, 0, 1700003000)

    const row = db
      .prepare('SELECT * FROM trace_references WHERE source_experience_id = ?')
      .get(src) as Record<string, unknown> | undefined
    expect(row).toBeDefined()
    expect(row!['referenced_experience_id']).toBe(ref)
    expect(row!['stale']).toBe(0)
  })

  it('TC17: trace_references stale flag can be updated', () => {
    const db = freshDb()
    const src = insertExperience(db)
    const ref = insertExperience(db)
    const result = db.prepare(`
      INSERT INTO trace_references (source_experience_id, referenced_experience_id, stale, created_at)
      VALUES (?, ?, 0, ?)
    `).run(src, ref, 1700003000) as Database.RunResult
    const rowId = result.lastInsertRowid

    db.prepare('UPDATE trace_references SET stale = 1 WHERE id = ?').run(rowId)
    const row = db.prepare('SELECT stale FROM trace_references WHERE id = ?').get(rowId) as
      | { stale: number }
      | undefined
    expect(row!.stale).toBe(1)
  })

  it('TC18: query by question_id uses index (returns correct row)', () => {
    const db = freshDb()
    const exp1 = insertExperience(db)
    const exp2 = insertExperience(db)
    db.prepare('UPDATE experiences SET question_id = ? WHERE id = ?').run('q-unique-999', exp1)
    db.prepare('UPDATE experiences SET question_id = ? WHERE id = ?').run('q-other', exp2)

    const rows = db
      .prepare('SELECT id FROM experiences WHERE question_id = ?')
      .all('q-unique-999') as Array<{ id: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(exp1)
  })

  it('TC19: domain_ecosystem + domain_layer compound query works', () => {
    const db = freshDb()
    const exp1 = insertExperience(db)
    const exp2 = insertExperience(db)
    db.prepare(
      'UPDATE experiences SET domain_ecosystem = ?, domain_layer = ? WHERE id = ?'
    ).run('docker', 'infra', exp1)
    db.prepare(
      'UPDATE experiences SET domain_ecosystem = ?, domain_layer = ? WHERE id = ?'
    ).run('k8s', 'infra', exp2)

    const rows = db
      .prepare('SELECT id FROM experiences WHERE domain_ecosystem = ? AND domain_layer = ?')
      .all('docker', 'infra') as Array<{ id: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(exp1)
  })
})
