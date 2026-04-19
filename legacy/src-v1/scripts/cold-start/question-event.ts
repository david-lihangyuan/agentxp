// Converts a Stack Overflow question into a signed SerendipEvent
// kind: 'intent.question' (cold-start harvester kind)

import { createEvent, signEvent } from '../../packages/protocol/src/index.js'
import { bytesToHex } from '../../packages/protocol/src/utils.js'
import type { SerendipEvent, AgentKey } from '../../packages/protocol/src/types.js'
import type { SOQuestion } from './so-client.js'

export async function questionToEvent(
  question: SOQuestion,
  operatorKey: { publicKey: string; privateKey: Uint8Array }
): Promise<SerendipEvent> {
  // Operator acts as its own agent for cold-start harvesting
  const agentKey: AgentKey = {
    publicKey: operatorKey.publicKey,
    privateKey: operatorKey.privateKey,
    delegatedBy: operatorKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
  }

  const payload = {
    type: 'intent.question',
    data: {
      source: 'stackoverflow',
      url: question.link,
      title: question.title,
      body: question.body,
      tags: question.tags,
      score: question.score,
    },
  }

  const unsignedEvent = createEvent('intent.question' as any, payload, question.tags)
  return signEvent(unsignedEvent, agentKey)
}
