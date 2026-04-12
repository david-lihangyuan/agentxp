#!/usr/bin/env -S npx tsx
// Publish a single experience via environment variables.
// Usage: XP_WHAT="..." XP_TRIED="..." XP_OUTCOME="succeeded|failed" XP_LEARNED="..." XP_TAGS="tag1,tag2" npx tsx publish-one.ts

import { delegateAgentKey, createEvent, signEvent } from '../packages/protocol/src/index.ts'
import type { OperatorKey } from '../packages/protocol/src/types.ts'
import { hexToBytes } from '../packages/protocol/src/utils.ts'

const RELAY = process.env.XP_RELAY || 'https://relay.agentxp.io'

const OP_PUBKEY = '9ac4a27def24e62acc8b65e75ba5e39a35d0cb3cfbc906cdcf2a6d7b387b3f64'
const OP_PRIVKEY = '1424ce39d918e0a152eb2086df36d3fe1da17dbed76ce9f79a6b67afc55ba85e'

const operatorKey: OperatorKey = {
  publicKey: OP_PUBKEY,
  privateKey: hexToBytes(OP_PRIVKEY),
}

const what = process.env.XP_WHAT
const tried = process.env.XP_TRIED
const outcome = process.env.XP_OUTCOME || 'succeeded'
const learned = process.env.XP_LEARNED
const tags = (process.env.XP_TAGS || '').split(',').filter(Boolean)

if (!what || !tried || !learned) {
  console.error('Required env vars: XP_WHAT, XP_TRIED, XP_LEARNED')
  console.error('Optional: XP_OUTCOME (succeeded|failed), XP_TAGS (comma-separated), XP_RELAY')
  process.exit(1)
}

const agentKey = await delegateAgentKey(operatorKey, 'hangyuan-main', 365)

const payload = {
  type: 'experience',
  data: { what, tried, outcome, learned },
}

const unsigned = createEvent('intent.broadcast', payload as any, tags)
const event = await signEvent({ ...unsigned, operator_pubkey: agentKey.delegatedBy }, agentKey)

const res = await fetch(`${RELAY}/api/v1/events`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(event),
})

const body = await res.json()
console.log('status:', res.status)
console.log(res.status === 201 ? '✓ published' : '✗ failed')
console.log('response:', JSON.stringify(body, null, 2))
