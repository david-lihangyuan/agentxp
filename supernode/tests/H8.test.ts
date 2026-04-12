// H8/H9: Per-agent metrics and A/B experiment tracking tests
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db'
import { MetricsAPI } from '../src/agentxp/metrics-api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  return db
}

function insertExperience(db: Database.Database, opts: {
  pubkey: string
  operator_pubkey?: string
  outcome?: string
  is_failure?: number
  created_at?: number
  tags?: string[]
}): void {
  const eventId = `evt-${Math.random().toString(36).slice(2)}`
  db.prepare(`
    INSERT OR IGNORE INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
    VALUES (?, ?, ?, 'intent.broadcast', ?, '{}', '[]', 'public', 'sig', ?)
  `).run(eventId, opts.pubkey, opts.operator_pubkey ?? 'op1', opts.created_at ?? Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))

  db.prepare(`
    INSERT OR IGNORE INTO experiences
      (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility, is_failure, embedding_status, created_at)
    VALUES (?, ?, ?, 'what', 'tried', ?, 'learned', ?, 'public', ?, 'pending', ?)
  `).run(
    eventId,
    opts.pubkey,
    opts.operator_pubkey ?? 'op1',
    opts.outcome ?? 'succeeded',
    JSON.stringify(opts.tags ?? []),
    opts.is_failure ?? 0,
    opts.created_at ?? Math.floor(Date.now() / 1000),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('H8/H9: MetricsAPI', () => {
  let db: Database.Database
  let api: MetricsAPI

  beforeEach(() => {
    db = makeDb()
    api = new MetricsAPI(db)
  })

  // H8: Per-agent metrics
  describe('getAllAgentMetrics', () => {
    it('returns empty array when no experiences', () => {
      expect(api.getAllAgentMetrics()).toEqual([])
    })

    it('returns one entry per agent pubkey', () => {
      insertExperience(db, { pubkey: 'agent-a', operator_pubkey: 'op1' })
      insertExperience(db, { pubkey: 'agent-b', operator_pubkey: 'op2' })
      insertExperience(db, { pubkey: 'agent-a', operator_pubkey: 'op1' })

      const metrics = api.getAllAgentMetrics()
      expect(metrics).toHaveLength(2)
      const a = metrics.find(m => m.pubkey === 'agent-a')!
      expect(a.experience_count).toBe(2)
    })

    it('calculates failure_rate correctly', () => {
      insertExperience(db, { pubkey: 'agent-a', outcome: 'succeeded', is_failure: 0 })
      insertExperience(db, { pubkey: 'agent-a', outcome: 'failed', is_failure: 1 })

      const metrics = api.getAllAgentMetrics()
      const a = metrics.find(m => m.pubkey === 'agent-a')!
      expect(a.failure_count).toBe(1)
      expect(a.failure_rate).toBe(0.5)
    })

    it('counts unique tags as exploration depth proxy', () => {
      insertExperience(db, { pubkey: 'agent-a', tags: ['retry', 'langchain'] })
      insertExperience(db, { pubkey: 'agent-a', tags: ['retry', 'crewai'] }) // 'retry' duplicated

      const metrics = api.getAllAgentMetrics()
      const a = metrics.find(m => m.pubkey === 'agent-a')!
      // unique: retry, langchain, crewai = 3
      expect(a.unique_tags).toBe(3)
    })

    it('orders agents by experience_count descending', () => {
      insertExperience(db, { pubkey: 'agent-b' })
      insertExperience(db, { pubkey: 'agent-a' })
      insertExperience(db, { pubkey: 'agent-a' })

      const metrics = api.getAllAgentMetrics()
      expect(metrics[0]!.pubkey).toBe('agent-a')
    })
  })

  describe('getAgentDetailedMetrics', () => {
    it('returns null for unknown pubkey', () => {
      expect(api.getAgentDetailedMetrics('unknown')).toBeNull()
    })

    it('returns detailed metrics with daily breakdown', () => {
      insertExperience(db, { pubkey: 'agent-a' })
      const detail = api.getAgentDetailedMetrics('agent-a')
      expect(detail).not.toBeNull()
      expect(detail!.experience_count).toBe(1)
      expect(Array.isArray(detail!.daily)).toBe(true)
    })
  })

  // H9: A/B experiment tracking
  describe('registerABGroups + getABSummary', () => {
    it('creates experiment_groups table and registers agents', () => {
      api.registerABGroups([
        { label: 'curiosity-opus', pubkey: 'agent-a' },
        { label: 'reward-gpt5', pubkey: 'agent-b' },
      ])

      const rows = db.prepare('SELECT * FROM experiment_groups').all() as Array<{ label: string; pubkey: string }>
      expect(rows).toHaveLength(2)
      expect(rows.find(r => r.pubkey === 'agent-a')!.label).toBe('curiosity-opus')
    })

    it('getABSummary returns one group per label', () => {
      insertExperience(db, { pubkey: 'agent-a', operator_pubkey: 'op1' })
      insertExperience(db, { pubkey: 'agent-b', operator_pubkey: 'op2' })
      insertExperience(db, { pubkey: 'agent-b', operator_pubkey: 'op2' })

      api.registerABGroups([
        { label: 'curiosity-opus', pubkey: 'agent-a' },
        { label: 'reward-gpt5', pubkey: 'agent-b' },
      ])

      const summary = api.getABSummary()
      expect(summary.groups).toHaveLength(2)

      const groupA = summary.groups.find(g => g.label === 'curiosity-opus')!
      expect(groupA.avg_experience_count).toBe(1)

      const groupB = summary.groups.find(g => g.label === 'reward-gpt5')!
      expect(groupB.avg_experience_count).toBe(2)
    })

    it('getABSummary returns single group when no experiment_groups table', () => {
      insertExperience(db, { pubkey: 'agent-a' })
      // No registerABGroups called — table does not exist
      const summary = api.getABSummary()
      expect(summary.groups).toHaveLength(1)
      expect(summary.groups[0]!.label).toBe('all-agents')
    })

    it('avg_failure_rate reflects actual data', () => {
      insertExperience(db, { pubkey: 'agent-a', is_failure: 0 })
      insertExperience(db, { pubkey: 'agent-a', is_failure: 1 })
      insertExperience(db, { pubkey: 'agent-b', is_failure: 0 })

      api.registerABGroups([
        { label: 'group-x', pubkey: 'agent-a' },
        { label: 'group-y', pubkey: 'agent-b' },
      ])

      const summary = api.getABSummary()
      const gx = summary.groups.find(g => g.label === 'group-x')!
      expect(gx.avg_failure_rate).toBe(0.5)
      const gy = summary.groups.find(g => g.label === 'group-y')!
      expect(gy.avg_failure_rate).toBe(0)
    })
  })
})
