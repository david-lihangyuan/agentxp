// Payload schema for io.agentxp.verification events.
// Protocol spec v1 reserves the kind but does not fix its payload shape;
// we standardise on the { type, data } envelope already used by experience
// payloads so the application layer stays consistent.

import { z } from 'zod'
import { PUBKEY_PATTERN } from '../validate'

export const VerificationPayload = z.object({
  type: z.literal('verification'),
  data: z.object({
    target_event_id: z
      .string()
      .regex(PUBKEY_PATTERN, 'target_event_id must be 64 hex chars'),
    outcome: z.enum(['confirmed', 'refuted', 'partial']),
    notes: z.string().optional(),
  }),
})

export type VerificationData = z.infer<typeof VerificationPayload>['data']

/** Parse an event payload as a verification record. */
export function parseVerificationPayload(
  payload: unknown,
): { ok: true; data: VerificationData } | { ok: false; error: string } {
  const parsed = VerificationPayload.safeParse(payload)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const msg = issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'invalid payload'
    return { ok: false, error: `invalid verification payload (${msg})` }
  }
  return { ok: true, data: parsed.data.data }
}
