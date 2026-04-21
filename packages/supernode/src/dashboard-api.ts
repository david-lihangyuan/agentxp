// Dashboard read-only aggregation queries.
// SPEC 01-interfaces §5.5; 03-modules-product §7. Every metric
// returned here MUST trace back to a query against the derived
// views in 02-data-model.md §6 — no fabricated aggregates.
import type { Db } from './db.js'

export interface OperatorSummary {
  pubkey: string
  experiences: number
  agents: number
  succeeded: number
  failed: number
  partial: number
  inconclusive: number
  first_experience_at: number | null
  last_experience_at: number | null
}

export function operatorSummary(db: Db, pubkey: string): OperatorSummary | null {
  const idRow = db.prepare(`SELECT 1 FROM identities WHERE pubkey = ?`).get(pubkey)
  if (!idRow) return null
  const expRow = db
    .prepare(
      `SELECT
         COUNT(*) AS experiences,
         SUM(CASE WHEN ex.outcome = 'succeeded'    THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN ex.outcome = 'failed'       THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN ex.outcome = 'partial'      THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN ex.outcome = 'inconclusive' THEN 1 ELSE 0 END) AS inconclusive,
         MIN(ex.created_at) AS first_at,
         MAX(ex.created_at) AS last_at
       FROM experiences ex
       JOIN events e ON e.id = ex.event_id
       WHERE e.operator_pubkey = ?`,
    )
    .get(pubkey) as {
    experiences: number
    succeeded: number | null
    failed: number | null
    partial: number | null
    inconclusive: number | null
    first_at: number | null
    last_at: number | null
  }
  const agents = db
    .prepare(
      `SELECT COUNT(*) AS c FROM identities
        WHERE kind = 'agent' AND operator_pubkey = ? AND revoked = 0`,
    )
    .get(pubkey) as { c: number }
  return {
    pubkey,
    experiences: expRow.experiences,
    agents: agents.c,
    succeeded: expRow.succeeded ?? 0,
    failed: expRow.failed ?? 0,
    partial: expRow.partial ?? 0,
    inconclusive: expRow.inconclusive ?? 0,
    first_experience_at: expRow.first_at,
    last_experience_at: expRow.last_at,
  }
}

export interface GrowthBucket {
  day_bucket: number
  count: number
}

export function operatorGrowth(db: Db, pubkey: string, days: number): GrowthBucket[] {
  return db
    .prepare(
      `SELECT (ex.created_at / 86400) AS day_bucket, COUNT(*) AS count
         FROM experiences ex JOIN events e ON e.id = ex.event_id
        WHERE e.operator_pubkey = ?
        GROUP BY day_bucket
        ORDER BY day_bucket DESC
        LIMIT ?`,
    )
    .all(pubkey, days) as GrowthBucket[]
}

export interface FailureRow {
  event_id: string
  what: string
  outcome: string
  created_at: number
}

export function operatorFailures(db: Db, pubkey: string, limit: number): FailureRow[] {
  return db
    .prepare(
      `SELECT ex.event_id, ex.what, ex.outcome, ex.created_at
         FROM experiences ex JOIN events e ON e.id = ex.event_id
        WHERE e.operator_pubkey = ? AND ex.outcome IN ('failed','partial','inconclusive')
        ORDER BY ex.created_at DESC LIMIT ?`,
    )
    .all(pubkey, limit) as FailureRow[]
}

export interface RecentExperienceRow {
  event_id: string
  pubkey: string
  what: string
  outcome: string
  created_at: number
}

export function recentExperiences(db: Db, limit: number): RecentExperienceRow[] {
  return db
    .prepare(
      `SELECT event_id, pubkey, what, outcome, created_at
         FROM experiences ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as RecentExperienceRow[]
}

export interface NetworkOverview {
  operators: number
  agents: number
  experiences: number
  relations: number
  last_activity: number | null
}

export function networkOverview(db: Db): NetworkOverview {
  const operators = db
    .prepare(`SELECT COUNT(*) AS c FROM identities WHERE kind = 'operator'`)
    .get() as { c: number }
  const agents = db
    .prepare(`SELECT COUNT(*) AS c FROM identities WHERE kind = 'agent' AND revoked = 0`)
    .get() as { c: number }
  const experiences = db
    .prepare(`SELECT COUNT(*) AS c FROM experiences`)
    .get() as { c: number }
  const relations = db
    .prepare(`SELECT COUNT(*) AS c FROM experience_relations`)
    .get() as { c: number }
  const lastAct = db
    .prepare(`SELECT MAX(created_at) AS t FROM experiences`)
    .get() as { t: number | null }
  return {
    operators: operators.c,
    agents: agents.c,
    experiences: experiences.c,
    relations: relations.c,
    last_activity: lastAct.t,
  }
}

export interface AgentMetricsRow {
  pubkey: string
  operator_pubkey: string | null
  agent_id: string | null
  experiences: number
  last_activity: number | null
}

export function agentMetrics(db: Db, limit: number): AgentMetricsRow[] {
  return db
    .prepare(
      `SELECT i.pubkey, i.operator_pubkey, i.agent_id,
              COUNT(ex.event_id) AS experiences,
              MAX(ex.created_at) AS last_activity
         FROM identities i
         LEFT JOIN experiences ex ON ex.pubkey = i.pubkey
        WHERE i.kind = 'agent' AND i.revoked = 0
        GROUP BY i.pubkey
        ORDER BY experiences DESC, last_activity DESC NULLS LAST
        LIMIT ?`,
    )
    .all(limit) as AgentMetricsRow[]
}

export function agentMetric(db: Db, pubkey: string): AgentMetricsRow | null {
  const row = db
    .prepare(
      `SELECT i.pubkey, i.operator_pubkey, i.agent_id,
              COUNT(ex.event_id) AS experiences,
              MAX(ex.created_at) AS last_activity
         FROM identities i
         LEFT JOIN experiences ex ON ex.pubkey = i.pubkey
        WHERE i.pubkey = ? AND i.kind = 'agent'
        GROUP BY i.pubkey`,
    )
    .get(pubkey) as AgentMetricsRow | undefined
  return row ?? null
}
