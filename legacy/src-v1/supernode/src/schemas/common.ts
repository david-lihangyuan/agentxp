// Shared zod primitives for request-body schemas.

import { z } from 'zod'
import { PUBKEY_PATTERN, TAG_PATTERN } from '../validate'

export const PUBKEY = z.string().regex(PUBKEY_PATTERN, 'pubkey must be 64 hex chars')
export const TAG = z.string().regex(TAG_PATTERN, 'tag contains invalid characters')
export const NON_EMPTY_STRING = z.string().min(1)
