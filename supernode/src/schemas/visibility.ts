// PATCH /api/v1/visibility/:operator_pubkey

import { z } from 'zod'

export const VisibilityBody = z.object({
  default_visibility: z.enum(['public', 'private']),
})
