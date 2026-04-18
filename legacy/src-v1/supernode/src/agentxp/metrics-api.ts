// H8/H9: Per-agent metrics and A/B experiment tracking
//
// H8: Defines auto-adjustable params (score weights, heartbeat frequency)
//     vs human-only params (SOUL, BOUNDARY). Tracks per-agent metrics.
//
// H9: Logs per-agent metrics (experiences produced, hit rate, verification
//     rate, exploration depth) and generates comparison summaries.
//
// Endpoints (registered in app.ts):
//   GET /api/v1/metrics/agents          — all agents ranked
//   GET /api/v1/metrics/agent/:pubkey   — single agent detailed metrics
//   GET /api/v1/metrics/ab-summary      — A/B comparison across groups

import type Database from 'better-sqlite3'
import { logger } from '../logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentMetrics {
  pubkey: string
  operator_pubkey: string
  experience_count: number
  failure_count: number
  failure_rate: number
  verified_count: number
  verification_rate: number
  search_hit_count: number
  hit_rate: number
  /** Unique top-level tags used — proxy for exploration depth */
  unique_tags: number
  last_active_at: number | null
}

export interface DailyMetrics {
  date: string          // YYYY-MM-DD
  experience_count: number
  failure_count: number
  verified_count: number
  search_hit_count: number
}

export interface AgentDetailedMetrics extends AgentMetrics {
  daily: DailyMetrics[]
}

export interface ABGroup {
  label: string         // e.g. "curiosity-opus", "reward-gpt5"
  pubkeys: string[]
  avg_experience_count: number
  avg_failure_rate: number
  avg_verification_rate: number
  avg_hit_rate: number
  avg_unique_tags: number
}

export interface ABSummary {
  groups: ABGroup[]
  generated_at: number
}

// ---------------------------------------------------------------------------
// MetricsAPI class
// ---------------------------------------------------------------------------

export class MetricsAPI {
  constructor(private db: Database.Database) {}

  /**
   * Get metrics for all agents, ordered by experience_count desc.
   */
  getAllAgentMetrics(): AgentMetrics[] {
    const rows = this.db
      .prepare(`
        SELECT
          e.pubkey,
          e.operator_pubkey,
          COUNT(*) AS experience_count,
          SUM(e.is_failure) AS failure_count,
          MAX(e.created_at) AS last_active_at
        FROM experiences e
        GROUP BY e.pubkey
        ORDER BY experience_count DESC
      `)
      .all() as Array<{
        pubkey: string
        operator_pubkey: string
        experience_count: number
        failure_count: number
        last_active_at: number | null
      }>

    return rows.map(row => this._enrichMetrics(row))
  }

  /**
   * Get detailed metrics for a single agent pubkey.
   */
  getAgentDetailedMetrics(pubkey: string): AgentDetailedMetrics | null {
    const baseRow = this.db
      .prepare(`
        SELECT
          e.pubkey,
          e.operator_pubkey,
          COUNT(*) AS experience_count,
          SUM(e.is_failure) AS failure_count,
          MAX(e.created_at) AS last_active_at
        FROM experiences e
        WHERE e.pubkey = ?
        GROUP BY e.pubkey
      `)
      .get(pubkey) as {
        pubkey: string
        operator_pubkey: string
        experience_count: number
        failure_count: number
        last_active_at: number | null
      } | undefined

    if (!baseRow) return null

    const base = this._enrichMetrics(baseRow)

    // Daily breakdown (last 30 days)
    const dailyRows = this.db
      .prepare(`
        SELECT
          date(created_at, 'unixepoch') AS date,
          COUNT(*) AS experience_count,
          SUM(is_failure) AS failure_count
        FROM experiences
        WHERE pubkey = ?
          AND created_at >= strftime('%s', 'now', '-30 days')
        GROUP BY date
        ORDER BY date ASC
      `)
      .all(pubkey) as Array<{
        date: string
        experience_count: number
        failure_count: number
      }>

    const daily: DailyMetrics[] = dailyRows.map(d => ({
      date: d.date,
      experience_count: d.experience_count,
      failure_count: d.failure_count,
      verified_count: 0,    // pulse_events join omitted for simplicity
      search_hit_count: 0,
    }))

    return { ...base, daily }
  }

  /**
   * Generate an A/B summary comparing predefined experiment groups.
   *
   * Groups are derived from pubkey prefixes stored in experiment_groups table
   * if it exists, or fall back to "all agents" single group.
   */
  getABSummary(): ABSummary {
    const all = this.getAllAgentMetrics()

    // Check if experiment_groups table exists
    const tableExists = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='experiment_groups'`)
      .get()

    if (!tableExists) {
      // No groups defined — return all agents as one group
      const group = this._buildGroup('all-agents', all.map(a => a.pubkey), all)
      logger.debug('AB summary: no experiment_groups table, returning single group')
      return { groups: [group], generated_at: Math.floor(Date.now() / 1000) }
    }

    const groupRows = this.db
      .prepare('SELECT label, pubkey FROM experiment_groups')
      .all() as Array<{ label: string; pubkey: string }>

    const groupMap: Record<string, string[]> = {}
    for (const row of groupRows) {
      if (!groupMap[row.label]) groupMap[row.label] = []
      groupMap[row.label]!.push(row.pubkey)
    }

    const groups: ABGroup[] = Object.entries(groupMap).map(([label, pubkeys]) => {
      return this._buildGroup(label, pubkeys, all)
    })

    return { groups, generated_at: Math.floor(Date.now() / 1000) }
  }

  /**
   * Register agents into A/B groups. Creates experiment_groups table if needed.
   * Call this at startup or when re-configuring the experiment.
   */
  registerABGroups(groups: Array<{ label: string; pubkey: string }>): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experiment_groups (
        label TEXT NOT NULL,
        pubkey TEXT NOT NULL,
        registered_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (pubkey)
      )
    `)

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO experiment_groups (label, pubkey)
      VALUES (?, ?)
    `)

    const insertMany = this.db.transaction((rows: Array<{ label: string; pubkey: string }>) => {
      for (const row of rows) {
        stmt.run(row.label, row.pubkey)
      }
    })

    insertMany(groups)
    logger.info('AB groups registered', { count: groups.length })
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _enrichMetrics(row: {
    pubkey: string
    operator_pubkey: string
    experience_count: number
    failure_count: number
    last_active_at: number | null
  }): AgentMetrics {
    const failure_rate = row.experience_count > 0
      ? Math.round((row.failure_count / row.experience_count) * 100) / 100
      : 0

    // Verified count
    const verifiedRow = this.db
      .prepare(`
        SELECT COUNT(DISTINCT pe.experience_id) as count
        FROM pulse_events pe
        JOIN experiences e ON e.id = pe.experience_id
        WHERE e.pubkey = ? AND pe.type = 'verified'
      `)
      .get(row.pubkey) as { count: number }
    const verified_count = verifiedRow.count

    // Search hit count (impact_log)
    let search_hit_count = 0
    try {
      const hitRow = this.db
        .prepare(`
          SELECT COUNT(*) as count
          FROM impact_log il
          JOIN experiences e ON e.id = il.experience_id
          WHERE e.pubkey = ? AND il.action = 'search_hit'
        `)
        .get(row.pubkey) as { count: number }
      search_hit_count = hitRow.count
    } catch {
      // impact_log may not exist in older schemas
    }

    const verification_rate = row.experience_count > 0
      ? Math.round((verified_count / row.experience_count) * 100) / 100
      : 0

    const hit_rate = row.experience_count > 0
      ? Math.round((search_hit_count / row.experience_count) * 100) / 100
      : 0

    // Unique tags (exploration depth proxy)
    const tagRows = this.db
      .prepare('SELECT tags FROM experiences WHERE pubkey = ?')
      .all(row.pubkey) as Array<{ tags: string }>

    const tagSet = new Set<string>()
    for (const t of tagRows) {
      try {
        const arr: string[] = JSON.parse(t.tags)
        for (const tag of arr) tagSet.add(tag)
      } catch { /* skip */ }
    }

    return {
      pubkey: row.pubkey,
      operator_pubkey: row.operator_pubkey,
      experience_count: row.experience_count,
      failure_count: row.failure_count,
      failure_rate,
      verified_count,
      verification_rate,
      search_hit_count,
      hit_rate,
      unique_tags: tagSet.size,
      last_active_at: row.last_active_at,
    }
  }

  private _buildGroup(label: string, pubkeys: string[], allMetrics: AgentMetrics[]): ABGroup {
    const members = allMetrics.filter(m => pubkeys.includes(m.pubkey))
    const n = members.length

    if (n === 0) {
      return { label, pubkeys, avg_experience_count: 0, avg_failure_rate: 0, avg_verification_rate: 0, avg_hit_rate: 0, avg_unique_tags: 0 }
    }

    const avg = (key: keyof AgentMetrics): number => {
      const sum = members.reduce((acc, m) => acc + (m[key] as number), 0)
      return Math.round((sum / n) * 100) / 100
    }

    return {
      label,
      pubkeys,
      avg_experience_count: avg('experience_count'),
      avg_failure_rate: avg('failure_rate'),
      avg_verification_rate: avg('verification_rate'),
      avg_hit_rate: avg('hit_rate'),
      avg_unique_tags: avg('unique_tags'),
    }
  }
}
