// Human Layer — HL3: Human Direct Contribution
// Operators can publish experiences directly from the dashboard without agent proxy.
// Human contributions get higher base trust weight (2.0 vs agent default 1.0).

import type Database from 'better-sqlite3'
import type { Context, Hono } from 'hono'
import { logger } from '../../logger'

export interface HumanContributionInput {
  content?: string  // alternative to what/tried/outcome/learned
  what?: string
  tried?: string
  outcome?: string
  learned?: string
  title?: string
  tags?: string[]
}

export interface HumanContributionResult {
  ok: true
  id: number
  experience_id: number
}

/**
 * Store a human-contributed experience directly into the experiences table.
 * contributor_type = 'human', trust_weight = 2.0
 * These are stored locally only — they need no protocol event.
 */
export function storeHumanContribution(
  db: Database.Database,
  operatorPubkey: string,
  input: HumanContributionInput
): { ok: true; id: number } | { ok: false; error: string } {
  // Normalize fields — accept either what/tried/outcome/learned or content+title
  const what = input.what ?? input.title ?? input.content ?? ''
  const tried = input.tried ?? ''
  const outcome = input.outcome ?? 'succeeded'
  const learned = input.learned ?? input.content ?? what

  if (!what.trim()) {
    return { ok: false, error: 'content or what is required' }
  }

  const tags = input.tags ?? []
  const now = Math.floor(Date.now() / 1000)

  // Human contributions don't have a protocol event_id — use a deterministic placeholder
  const pseudoEventId = `human-${operatorPubkey.slice(0, 16)}-${now}-${Math.random().toString(36).slice(2, 8)}`
  const isFailure = outcome === 'failed' ? 1 : 0

  try {
    // Human contributions need a placeholder event row to satisfy the FK constraint.
    // kind='operator.human_contribution' is a local-only kind — never synced to the network.
    db.prepare(`
      INSERT OR IGNORE INTO events
        (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, 'operator.human_contribution', ?, ?, '[]', 'private', 'local', ?)
    `).run(
      pseudoEventId,
      operatorPubkey,
      operatorPubkey,
      now,
      JSON.stringify({ type: 'human_contribution', data: { what, learned } }),
      now
    )

    const result = db
      .prepare(`
        INSERT INTO experiences
          (event_id, pubkey, operator_pubkey, what, tried, outcome, learned, tags, visibility,
           is_failure, embedding_status, created_at, contributor_type, trust_weight)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, 'pending', ?, 'human', 2.0)
      `)
      .run(
        pseudoEventId,
        operatorPubkey,
        operatorPubkey,
        what.trim(),
        tried.trim(),
        outcome,
        learned.trim(),
        JSON.stringify(tags),
        isFailure,
        now
      )

    const id = result.lastInsertRowid as number
    logger.info('Human contribution stored', { id, operator_pubkey: operatorPubkey })
    return { ok: true, id }
  } catch (err) {
    logger.error('Failed to store human contribution', { error: String(err) })
    return { ok: false, error: 'failed to store contribution' }
  }
}

/**
 * Register human contribution routes on a Hono router instance.
 */
export function registerHumanContributionRoutes(
  api: Hono,
  db: Database.Database
): void {
  // POST /api/v1/operator/:pubkey/contribute
  api.post('/operator/:pubkey/contribute', async (c: Context) => {
    const operatorPubkey = c.req.param('pubkey')
    if (!operatorPubkey) return c.json({ error: 'pubkey required' }, 400)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const input = body as HumanContributionInput

    const result = storeHumanContribution(db, operatorPubkey, input)
    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ ok: true, id: result.id }, 201)
  })

  // GET /api/v1/experiences?contributor_type=human
  // Note: This is registered in app.ts on the main /experiences route,
  // but we expose the filter logic here for the search endpoint to use.
}

/**
 * Apply contributor_type filter to the experiences search query.
 * Used by the main /search and /experiences endpoints.
 */
export function buildContributorTypeFilter(contributorType: string | undefined): string {
  if (!contributorType) return ''
  // Only 'human' and 'agent' are valid
  if (contributorType !== 'human' && contributorType !== 'agent') return ''
  return ` AND contributor_type = '${contributorType}'`
}
