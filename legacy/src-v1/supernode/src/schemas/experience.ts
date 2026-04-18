// POST /api/v1/experiences/:id/relations

import { z } from 'zod'
import { PUBKEY } from './common'

export const ExperienceRelationBody = z.object({
  target_id: z.number().int().positive(),
  relation_type: z.enum(['extends', 'qualifies', 'supersedes']),
  pubkey: PUBKEY.optional(),
})
