// Human Layer — HL1: Letters to Agent
// Operators write private letters to their agent. Stored locally only, never published to network.
// Letters are available via GET /api/v1/operator/:pubkey/letter
// POST /api/v1/operator/:pubkey/letter

import type Database from 'better-sqlite3'
import type { Context } from 'hono'

export interface OperatorLetter {
  id: number
  operator_pubkey: string
  content: string
  written_at: string  // ISO 8601
}

/**
 * Store a new letter from an operator to their agent.
 * Multiple letters can exist; GET returns the latest.
 */
export function storeLetter(
  db: Database.Database,
  operatorPubkey: string,
  content: string
): { ok: true; id: number } | { ok: false; error: string } {
  if (!content || content.trim().length === 0) {
    return { ok: false, error: 'content is required' }
  }

  const now = Math.floor(Date.now() / 1000)
  const result = db
    .prepare('INSERT INTO operator_letters (operator_pubkey, content, created_at) VALUES (?, ?, ?)')
    .run(operatorPubkey, content.trim(), now)

  return { ok: true, id: result.lastInsertRowid as number }
}

/**
 * Retrieve the latest letter for an operator.
 * Returns null if no letters exist.
 */
export function getLatestLetter(
  db: Database.Database,
  operatorPubkey: string
): OperatorLetter | null {
  const row = db
    .prepare(
      'SELECT id, operator_pubkey, content, created_at FROM operator_letters WHERE operator_pubkey = ? ORDER BY created_at DESC, id DESC LIMIT 1'
    )
    .get(operatorPubkey) as { id: number; operator_pubkey: string; content: string; created_at: number } | undefined

  if (!row) return null

  return {
    id: row.id,
    operator_pubkey: row.operator_pubkey,
    content: row.content,
    written_at: new Date(row.created_at * 1000).toISOString(),
  }
}

/**
 * Register letter routes on a Hono router instance.
 * Call from app.ts: registerLetterRoutes(api, db)
 */
export function registerLetterRoutes(api: { post: Function; get: Function }, db: Database.Database): void {
  // POST /api/v1/operator/:pubkey/letter
  api.post('/operator/:pubkey/letter', async (c: Context) => {
    const operatorPubkey = c.req.param('pubkey')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const input = body as Record<string, unknown>
    const content = input['content']
    if (typeof content !== 'string' || content.trim().length === 0) {
      return c.json({ error: 'content is required' }, 400)
    }

    const result = storeLetter(db, operatorPubkey, content)
    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ ok: true, id: result.id }, 201)
  })

  // GET /api/v1/operator/:pubkey/letter
  api.get('/operator/:pubkey/letter', (c: Context) => {
    const operatorPubkey = c.req.param('pubkey')
    const letter = getLatestLetter(db, operatorPubkey)
    if (!letter) {
      return c.json({ error: 'no letter found' }, 404)
    }
    return c.json(letter)
  })
}
