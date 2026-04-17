// POST /api/v1/subscriptions

import { z } from 'zod'
import { PUBKEY, TAG, NON_EMPTY_STRING } from './common'

export const SubscriptionBody = z.object({
  pubkey: PUBKEY,
  operator_pubkey: PUBKEY.optional(),
  query: NON_EMPTY_STRING,
  tags: z.array(TAG).optional(),
})
