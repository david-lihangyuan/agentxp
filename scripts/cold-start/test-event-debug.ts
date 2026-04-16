import { generateOperatorKey, createEvent, signEvent } from './packages/protocol/src/index.js'
import type { AgentKey } from './packages/protocol/src/types.js'

async function main() {
  const operatorKey = await generateOperatorKey()
  const agentKey: AgentKey = {
    publicKey: operatorKey.publicKey,
    privateKey: operatorKey.privateKey,
    delegatedBy: operatorKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
  }
  const payload = {
    type: 'intent.question',
    data: {
      source: 'github',
      url: 'https://github.com/openclaw/openclaw/issues/66460',
      title: 'test issue',
      body: 'test body',
      tags: ['openclaw'],
      score: 5,
    },
  }
  const unsigned = createEvent('intent.question' as any, payload, ['openclaw'])
  console.log('unsigned kind:', unsigned.kind)
  const signed = signEvent(unsigned, agentKey)
  console.log('signed event:', JSON.stringify(signed, (k, v) => k === 'privateKey' ? '[redacted]' : v, 2))
}
main().catch(console.error)
