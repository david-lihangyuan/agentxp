// POST /api/v1/pulse/outcome

import { z } from 'zod'
import { PUBKEY, NON_EMPTY_STRING } from './common'

export const PulseOutcomeBody = z.object({
  experience_id: z.number().int().positive(),
  reporter_pubkey: PUBKEY,
  outcome: NON_EMPTY_STRING,
  context: z.record(z.string(), z.unknown()).optional(),
})
