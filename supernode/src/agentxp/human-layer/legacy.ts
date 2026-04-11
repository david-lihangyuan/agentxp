// Human Layer — HL5: Legacy View
// Shows an operator what their contributions are still doing in the world.
// GET /api/v1/operator/:pubkey/legacy

import type Database from 'better-sqlite3'
import type { Context } from 'hono'

export interface LegacyView {
  still_active_count: number       // experiences not dormant, verified within 180 days
  helped_succeed_count: number     // resolved_hit events linked to operator's experiences
  total_experiences: number
  oldest_experience_date: string | null  // ISO date string or null
  display: string                  // "N experiences still helping agents today"
}

/** 180 days in seconds */
const ACTIVE_WINDOW_SECONDS = 180 * 86400

/**
 * Build the legacy view for an operator.
 * "still active" = experience with pulse state !== 'dormant' AND last verified within 180 days
 * "helped succeed" = count of resolved_hit events linked to this operator's experiences
 */
export function getLegacyView(db: Database.Database, operatorPubkey: string): LegacyView {
  const cutoff = Math.floor(Date.now() / 1000) - ACTIVE_WINDOW_SECONDS

  // Still active experiences: have a non-dormant pulse event AND last activity within 180 days
  const stillActiveRow = db
    .prepare(`
      SELECT COUNT(DISTINCT e.id) as count
      FROM experiences e
      WHERE e.operator_pubkey = ?
        AND (e.last_activity_at IS NULL OR e.last_activity_at >= ?)
        AND EXISTS (
          SELECT 1 FROM pulse_events pe
          WHERE pe.experience_id = e.id
            AND pe.type IN ('discovered', 'verified', 'propagating', 'resolved_hit', 'subscription_match')
        )
    `)
    .get(operatorPubkey, cutoff) as { count: number }

  // Helped succeed: resolved_hit events linked to operator's experiences
  const helpedSucceedRow = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM pulse_events pe
      JOIN experiences e ON pe.experience_id = e.id
      WHERE e.operator_pubkey = ? AND pe.type = 'resolved_hit'
    `)
    .get(operatorPubkey) as { count: number }

  // Total experiences
  const totalRow = db
    .prepare('SELECT COUNT(*) as count FROM experiences WHERE operator_pubkey = ?')
    .get(operatorPubkey) as { count: number }

  // Oldest experience date
  const oldestRow = db
    .prepare(
      'SELECT created_at FROM experiences WHERE operator_pubkey = ? ORDER BY created_at ASC LIMIT 1'
    )
    .get(operatorPubkey) as { created_at: number } | undefined

  const oldestDate = oldestRow
    ? new Date(oldestRow.created_at * 1000).toISOString().slice(0, 10)
    : null

  const stillActiveCount = stillActiveRow.count
  const display = `${stillActiveCount} experience${stillActiveCount !== 1 ? 's' : ''} still helping agents today`

  return {
    still_active_count: stillActiveCount,
    helped_succeed_count: helpedSucceedRow.count,
    total_experiences: totalRow.count,
    oldest_experience_date: oldestDate,
    display,
  }
}

/**
 * Register legacy routes on a Hono router instance.
 */
export function registerLegacyRoutes(api: { get: Function }, db: Database.Database): void {
  // GET /api/v1/operator/:pubkey/legacy
  api.get('/operator/:pubkey/legacy', (c: Context) => {
    const operatorPubkey = c.req.param('pubkey')
    const legacy = getLegacyView(db, operatorPubkey)
    return c.json(legacy)
  })
}
