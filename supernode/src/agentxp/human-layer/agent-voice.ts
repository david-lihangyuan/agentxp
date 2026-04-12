// Human Layer — HL2: Agent Speaks to Operator
// Detects repeated mistake patterns and proactively notifies the operator.
// Pattern threshold: same pattern 3+ times in 7 days.

import type Database from 'better-sqlite3'
import type { Context } from 'hono'

export interface PatternMatch {
  pattern: string
  count: number
  window_days: number
}

/**
 * Check if a given pattern appears in mistakes 3+ times within 7 days.
 * The 'pattern' parameter is matched against the 'what' column of experiences
 * that are tagged as mistakes (is_failure=1) or via pulse_events type.
 *
 * For HL2, we check pulse_events of type 'mistake' or 'error' or we
 * look at experiences where the pattern keyword appears in 'what' or 'learned'.
 */
export function detectPattern(
  db: Database.Database,
  agentPubkey: string,
  pattern: string,
  windowDays: number = 7,
  threshold: number = 3
): boolean {
  const windowStart = Math.floor(Date.now() / 1000) - windowDays * 86400

  // Count experiences from this agent matching the pattern keyword within the window
  const row = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM experiences
      WHERE pubkey = ?
        AND created_at >= ?
        AND (
          LOWER(what) LIKE '%' || LOWER(?) || '%'
          OR LOWER(learned) LIKE '%' || LOWER(?) || '%'
          OR LOWER(tried) LIKE '%' || LOWER(?) || '%'
        )
    `)
    .get(agentPubkey, windowStart, pattern, pattern, pattern) as { count: number }

  return row.count >= threshold
}

/**
 * Generate an observational (not complaint) message about a repeated pattern.
 * Tone: "I've noticed / encountered / hit" — never "you should" or "must".
 */
export function generateObservation(pattern: string): string {
  return `I've noticed a recurring pattern: "${pattern}" has come up 3 or more times recently. You may want to check mistakes.md for context.`
}

/**
 * Deliver a notification to the operator's notification table.
 * Type is 'agent_pattern' for pattern-triggered notifications.
 */
export function deliverNotification(
  db: Database.Database,
  operatorPubkey: string,
  message: string,
  type: string = 'agent_pattern'
): { ok: true; id: number } {
  const now = Math.floor(Date.now() / 1000)
  const result = db
    .prepare(
      'INSERT INTO operator_notifications (operator_pubkey, type, content, read, created_at) VALUES (?, ?, ?, 0, ?)'
    )
    .run(operatorPubkey, type, message, now)

  return { ok: true, id: result.lastInsertRowid as number }
}

/**
 * Register agent-voice routes on a Hono router instance.
 */
export function registerAgentVoiceRoutes(api: { get: Function; post: Function }, db: Database.Database): void {
  // GET /api/v1/operator/:pubkey/notifications — returns unread notifications
  api.get('/operator/:pubkey/notifications', (c: Context) => {
    const operatorPubkey = c.req.param('pubkey')

    const notifications = db
      .prepare(`
        SELECT id, operator_pubkey, type, content, read, created_at
        FROM operator_notifications
        WHERE operator_pubkey = ? AND read = 0
        ORDER BY created_at DESC
      `)
      .all(operatorPubkey) as Array<{
        id: number
        operator_pubkey: string
        type: string
        content: string
        read: number
        created_at: number
      }>

    return c.json({ notifications })
  })

  // POST /api/v1/operator/:pubkey/notifications/:id/read — mark as read
  api.post('/operator/:pubkey/notifications/:id/read', (c: Context) => {
    const operatorPubkey = c.req.param('pubkey')
    const id = Number(c.req.param('id'))

    if (isNaN(id)) {
      return c.json({ error: 'invalid notification id' }, 400)
    }

    const result = db
      .prepare(
        'UPDATE operator_notifications SET read = 1 WHERE id = ? AND operator_pubkey = ?'
      )
      .run(id, operatorPubkey)

    if (result.changes === 0) {
      return c.json({ error: 'notification not found' }, 404)
    }

    return c.json({ ok: true })
  })
}
