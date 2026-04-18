// Impact ledger + score calculation.
// SPEC 03-modules-product §9 (Feedback loop). Weights are appended
// to impact_ledger; `GET /experiences/:id/score` reduces them into a
// non-decreasing score. Anti-gaming rules:
//   - same-operator search_hit / verified MUST contribute 0.
//   - per-experience daily search_hit cap (10) MUST be respected.
//   - MVP never emits negative points.
import type { Db } from './db.js'

export type ImpactAction = 'search_hit' | 'verified' | 'cited' | 'resolved_hit'

// Cross-domain verifications MAY carry a higher multiplier than
// same-domain ones (§9); MVP keeps flat weights and defers the
// multiplier until we have a domain_fingerprint signal to key on.
const WEIGHTS: Record<ImpactAction, number> = {
  search_hit: 0.05,
  verified: 0.4,
  cited: 0.2,
  resolved_hit: 0.15,
}

const DAILY_SEARCH_HIT_CAP = 10

function dayBucket(t: number): number {
  return Math.floor(t / 86_400)
}

interface OperatorRow {
  operator_pubkey: string
}

// SPEC §9: "same-operator" is evaluated against operator keys, not
// agent keys, so a search from agent B owned by operator O still
// counts for experiences published by a different operator O'.
function experienceOperator(db: Db, experienceId: string): string | null {
  const row = db
    .prepare(
      `SELECT e.operator_pubkey AS operator_pubkey
         FROM experiences ex
         JOIN events e ON e.id = ex.event_id
        WHERE ex.event_id = ?`,
    )
    .get(experienceId) as OperatorRow | undefined
  return row ? row.operator_pubkey : null
}

function resolveOperator(db: Db, pubkey: string): string {
  const row = db
    .prepare(
      `SELECT kind, operator_pubkey FROM identities WHERE pubkey = ?`,
    )
    .get(pubkey) as { kind: string; operator_pubkey: string | null } | undefined
  if (!row) return pubkey
  if (row.kind === 'operator') return pubkey
  return row.operator_pubkey ?? pubkey
}

function isSameOperator(db: Db, experienceId: string, sourcePubkey: string): boolean {
  const expOp = experienceOperator(db, experienceId)
  if (expOp === null) return false
  const srcOp = resolveOperator(db, sourcePubkey)
  return expOp === srcOp
}

export interface AppendOptions {
  db: Db
  experienceId: string
  action: ImpactAction
  sourcePubkey: string | null
  now: number
}

export interface AppendResult {
  inserted: boolean
  weight: number
  reason?: string
}

export function appendImpact(opts: AppendOptions): AppendResult {
  const { db, experienceId, action, sourcePubkey, now } = opts
  const day = dayBucket(now)
  const same = sourcePubkey ? isSameOperator(db, experienceId, sourcePubkey) : false

  if (same && (action === 'search_hit' || action === 'verified')) {
    return { inserted: false, weight: 0, reason: 'same_operator' }
  }

  if (action === 'search_hit') {
    const daily = db
      .prepare(
        `SELECT COUNT(*) AS c FROM impact_ledger
          WHERE experience_id = ? AND action = 'search_hit' AND day_bucket = ?`,
      )
      .get(experienceId, day) as { c: number }
    if (daily.c >= DAILY_SEARCH_HIT_CAP) {
      return { inserted: false, weight: 0, reason: 'daily_cap' }
    }
  }

  const weight = WEIGHTS[action]
  db.prepare(
    `INSERT INTO impact_ledger
       (experience_id, action, weight, source_pubkey, same_operator, day_bucket, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(experienceId, action, weight, sourcePubkey, same ? 1 : 0, day, now)
  return { inserted: true, weight }
}

export interface ScoreBreakdown {
  impact_score: number
  verifications: number
  components: {
    search_hits: number
    verified_useful: number
    cited: number
    resolved: number
    superseded_by_count: number
  }
  last_updated: number | null
}

export function computeScore(db: Db, experienceId: string): ScoreBreakdown {
  const agg = db
    .prepare(
      `SELECT action, SUM(weight) AS w, COUNT(*) AS c, MAX(created_at) AS last
         FROM impact_ledger
        WHERE experience_id = ?
        GROUP BY action`,
    )
    .all(experienceId) as Array<{ action: ImpactAction; w: number; c: number; last: number }>

  const components = {
    search_hits: 0,
    verified_useful: 0,
    cited: 0,
    resolved: 0,
    superseded_by_count: 0,
  }
  let total = 0
  let verifications = 0
  let lastUpdated: number | null = null
  for (const r of agg) {
    total += r.w
    if (lastUpdated === null || r.last > lastUpdated) lastUpdated = r.last
    if (r.action === 'search_hit') components.search_hits = r.c
    else if (r.action === 'verified') {
      components.verified_useful = r.c
      verifications = r.c
    } else if (r.action === 'cited') components.cited = r.c
    else if (r.action === 'resolved_hit') components.resolved = r.c
  }

  const superseded = db
    .prepare(
      `SELECT COUNT(*) AS c FROM experience_relations
        WHERE to_experience_id = ? AND relation_type = 'supersedes'`,
    )
    .get(experienceId) as { c: number }
  components.superseded_by_count = superseded.c

  const bounded = Math.min(1, total)
  return { impact_score: bounded, verifications, components, last_updated: lastUpdated }
}
