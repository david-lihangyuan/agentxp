// Registers an operator + delegates an agent key on a live relay.
// Used only by scripts/m3-smoke.sh for MILESTONES M3 Check 2 evidence.
import { readFileSync } from 'node:fs'
import { createEvent, signEvent, hexToBytes } from '@agentxp/protocol'
import { ensureAgentKey } from '@agentxp/skill'

const root = process.env['ROOT']
if (!root) throw new Error('ROOT env required')
const opDisk = JSON.parse(readFileSync(root + '/home/.agentxp/identity/operator.json', 'utf8'))
const operator = { publicKey: opDisk.publicKey, privateKey: hexToBytes(opDisk.privateKey) }
const operatorAsAgent = {
  publicKey: operator.publicKey,
  privateKey: operator.privateKey,
  delegatedBy: operator.publicKey,
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
  agentId: 'self',
}

const relay = process.env['RELAY_URL'] ?? 'http://localhost:13141'

async function publish(event) {
  const res = await fetch(relay + '/api/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event }),
  })
  if (res.status !== 200) {
    throw new Error('publish failed ' + res.status + ' ' + (await res.text()))
  }
}

const reg = await signEvent(
  createEvent(
    'identity.register',
    {
      type: 'operator',
      data: { pubkey: operator.publicKey, registered_at: Math.floor(Date.now() / 1000) },
    },
    [],
  ),
  operatorAsAgent,
)
await publish(reg)

const agent = await ensureAgentKey(operator, 'm3-smoke', 30, root + '/home/.agentxp/identity')
const del = await signEvent(
  createEvent(
    'identity.delegate',
    {
      type: 'delegation',
      data: { agent_pubkey: agent.publicKey, expires_at: agent.expiresAt, agent_id: agent.agentId },
    },
    [],
  ),
  operatorAsAgent,
)
await publish(del)
console.log('identities registered; agent=' + agent.publicKey.slice(0, 12))
