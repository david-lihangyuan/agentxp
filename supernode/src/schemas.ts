// Supernode — Request Body Schemas
// Zod schemas for POST/PATCH bodies. Each schema is a single source of
// truth for one route. Error shape is normalized to { error: string } so
// the public API contract stays unchanged.

import type { Context } from 'hono'
import { z } from 'zod'
import { PUBKEY_PATTERN, TAG_PATTERN } from './validate'

const PUBKEY = z.string().regex(PUBKEY_PATTERN, 'pubkey must be 64 hex chars')
const TAG = z.string().regex(TAG_PATTERN, 'tag contains invalid characters')
const NON_EMPTY_STRING = z.string().min(1)

// POST /api/v1/subscriptions
export const SubscriptionBody = z.object({
  pubkey: PUBKEY,
  operator_pubkey: PUBKEY.optional(),
  query: NON_EMPTY_STRING,
  tags: z.array(TAG).optional(),
})

// POST /api/v1/nodes/register — supports both the new challenge-response
// interface and the legacy interface used by early clients.
const RegisterWithProof = z.object({
  relay_pubkey: PUBKEY,
  challenge: NON_EMPTY_STRING,
  signature: NON_EMPTY_STRING,
  url: NON_EMPTY_STRING,
})
const RegisterLegacy = z.object({
  pubkey: PUBKEY,
  url: NON_EMPTY_STRING,
  challengeSignature: NON_EMPTY_STRING,
})
export const RegisterNodeBody = z.union([RegisterWithProof, RegisterLegacy])

// POST /api/v1/pulse/outcome
export const PulseOutcomeBody = z.object({
  experience_id: z.number().int().positive(),
  reporter_pubkey: PUBKEY,
  outcome: NON_EMPTY_STRING,
  context: z.record(z.string(), z.unknown()).optional(),
})

// POST /api/v1/experiences/:id/relations
export const ExperienceRelationBody = z.object({
  target_id: z.number().int().positive(),
  relation_type: z.enum(['extends', 'qualifies', 'supersedes']),
  pubkey: PUBKEY.optional(),
})

// PATCH /api/v1/visibility/:operator_pubkey
export const VisibilityBody = z.object({
  default_visibility: z.enum(['public', 'private']),
})

// POST /api/cold-start/events/status
export const ColdStartStatusBody = z.object({
  event_id: NON_EMPTY_STRING,
  status: NON_EMPTY_STRING,
})

// POST /api/cold-start/claim
// Note: solver_pubkey is deliberately not PUBKEY-constrained — existing
// cold-start data uses non-hex identifiers like 'xp-solver-agent-01'.
export const ColdStartClaimBody = z.object({
  event_id: NON_EMPTY_STRING,
  solver_pubkey: NON_EMPTY_STRING,
})

// POST /api/cold-start/verify
export const ColdStartVerifyBody = z.object({
  solution_event_id: NON_EMPTY_STRING,
  passed: z.boolean(),
})

/**
 * Parse the JSON body of a request and validate it against a zod schema.
 * On failure returns a pre-built 400 response carrying { error: string };
 * on success returns the typed parsed data.
 *
 * Usage:
 *   const parsed = await parseBody(c, PulseOutcomeBody)
 *   if (!parsed.ok) return parsed.response
 *   // parsed.data is fully typed
 */
export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return { ok: false, response: c.json({ error: 'invalid JSON' }, 400) }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue.path.join('.')
    const msg = path ? `${path}: ${issue.message}` : issue.message
    return { ok: false, response: c.json({ error: msg }, 400) }
  }
  return { ok: true, data: parsed.data }
}
