// POST /api/v1/nodes/register — supports both the new challenge-response
// interface and the legacy interface used by early clients.

import { z } from 'zod'
import { PUBKEY, NON_EMPTY_STRING } from './common'

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
