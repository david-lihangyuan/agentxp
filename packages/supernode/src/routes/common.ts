// Shared utilities for route modules. Kept here rather than in
// src/app.ts so each route file can import what it needs without
// reaching across sibling modules.
import type { Context } from 'hono'
import type { SerendipEvent } from '@agentxp/protocol'
import type { Db } from '../db.js'
import { ingestEvent } from '../event-handler.js'

export const HEX64 = /^[0-9a-f]{64}$/
export const HEX128 = /^[0-9a-f]{128}$/

export function structuralCheck(e: unknown): e is SerendipEvent {
  if (typeof e !== 'object' || e === null) return false
  const x = e as Record<string, unknown>
  return (
    x.v === 1 &&
    typeof x.id === 'string' && HEX64.test(x.id) &&
    typeof x.pubkey === 'string' && HEX64.test(x.pubkey) &&
    typeof x.operator_pubkey === 'string' && HEX64.test(x.operator_pubkey) &&
    typeof x.created_at === 'number' &&
    typeof x.kind === 'string' &&
    typeof x.payload === 'object' && x.payload !== null &&
    Array.isArray(x.tags) &&
    (x.visibility === 'public' || x.visibility === 'private') &&
    typeof x.sig === 'string' && HEX128.test(x.sig)
  )
}

// Clamp a numeric query parameter. Used for `limit` on most list
// endpoints; default/max differ per endpoint per SPEC §5.
export function parseLimit(raw: string | undefined, def: number, max: number): number {
  const parsed = Number(raw ?? String(def))
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), 1), max)
    : def
}

// Accept a signed event on the wire, pass it to ingestEvent, and
// shape the response per SPEC §5 (accepted envelope or error).
// Three routes share this exact pattern: POST /events, POST
// /pulse/outcome, and POST /experiences/:id/relations.
export async function ingestAndRespond(c: Context, db: Db) {
  const body = (await c.req.json().catch(() => null)) as { event?: unknown } | null
  if (!body || !structuralCheck(body.event)) {
    return c.json({ error: 'malformed_event' }, 400)
  }
  const result = await ingestEvent(db, body.event)
  if (!result.ok) {
    return c.json(
      { error: result.error, ...(result.field ? { field: result.field } : {}) },
      result.status,
    )
  }
  return c.json({
    accepted: true,
    event_id: result.event_id,
    merkle_proof: result.event_id,
    received_at: result.received_at,
  })
}
