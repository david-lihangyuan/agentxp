// Bodies for the /api/cold-start/* pipeline routes.

import { z } from 'zod'
import { NON_EMPTY_STRING } from './common'

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
