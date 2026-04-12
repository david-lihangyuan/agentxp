// End-to-end publish test: create a draft and publish to relay.agentxp.io
import { createDraft, runBatchPublish } from '../src/publisher.js'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const testWorkspace = '/tmp/agentxp-publish-test-' + Date.now()
mkdirSync(join(testWorkspace, 'drafts'), { recursive: true })
mkdirSync(join(testWorkspace, 'published'), { recursive: true })

await createDraft({
  what: 'LangChain RetryOutputParser infinite loop',
  tried: 'triggered OutputParserException with malformed LLM output in LangChain v0.2',
  outcome: 'failed',
  learned: 'RetryOutputParser has no built-in loop limit; pair with max_retries=3 explicit stop',
}, testWorkspace)

console.log('Draft created. Publishing to relay...')

const result = await runBatchPublish(testWorkspace, {
  relayUrl: 'https://relay.agentxp.io',
  agentHomeDir: '/Users/david/.openclaw/workspace/agents/coding-01',
})

console.log('Result:', JSON.stringify(result, null, 2))
// Also try direct curl to see what relay says
import { execSync } from 'child_process'
import { createEvent, signEvent, delegateAgentKey } from '@serendip/protocol'
import type { OperatorKey } from '@serendip/protocol'
import { readFileSync } from 'fs'
import { join } from 'path'

const agentHome = '/Users/david/.openclaw/workspace/agents/coding-01'
const privHex = readFileSync(join(agentHome, '.agentxp/identity/operator.key'), 'utf8').trim()
const pubKey = readFileSync(join(agentHome, '.agentxp/identity/operator.pub'), 'utf8').trim()
const privBytes = new Uint8Array(privHex.length / 2)
for (let i = 0; i < privBytes.length; i++) privBytes[i] = parseInt(privHex.slice(i*2, i*2+2), 16)
const opKey: OperatorKey = { publicKey: pubKey, privateKey: privBytes }
const agentKey = await delegateAgentKey(opKey, 'test', 1)
const event = createEvent({ kind: 'experience.coding', pubkey: agentKey.publicKey, content: 'test' })
const signed = await signEvent(event, agentKey)
console.log('\nSigned event (first 200 chars):', JSON.stringify(signed).slice(0, 200))

const res = await fetch('https://relay.agentxp.io/api/v1/events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(signed),
})
const body = await res.text()
console.log('Relay response:', res.status, body)

rmSync(testWorkspace, { recursive: true, force: true })
