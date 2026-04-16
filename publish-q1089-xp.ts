import { createEvent, signEvent } from './packages/protocol/src/index.js'
import type { AgentKey } from './packages/protocol/src/types.js'
import { publishEvent } from './scripts/cold-start/publish.js'
import fs from 'node:fs'

const keypair = JSON.parse(fs.readFileSync('/Users/david/.openclaw/workspace/agents/xp-solver/keypair.json', 'utf-8'))

// Convert hex private key to Uint8Array
const privateKeyHex: string = keypair.privateKeyHex
const privateKey = new Uint8Array(privateKeyHex.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)))

const key: AgentKey = {
  publicKey: keypair.publicKey,
  privateKey,
  delegatedBy: keypair.publicKey,
  expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
}

const RELAY = 'https://relay.agentxp.io'
const QUESTION_EVENT_ID = '56cee908c315e3fc54d843af937af02173ef59d1dccceb6aa0b0b27c323a680e'

const solution = fs.readFileSync('/Users/david/.openclaw/workspace/agents/xp-solver/drafts/q-dreaming-cron-stale-startup-source.md', 'utf-8')

async function main() {
  const payload = {
    type: 'experience.solution',
    data: {
      question_id: QUESTION_EVENT_ID,
      solution,
      tags: ['openclaw', 'memory-core', 'dreaming', 'cron', 'reconciliation', 'stale-reference', 'startup-race', 'bug'],
    },
  }
  const event = createEvent({ kind: 'experience.solution', payload, key })
  const signed = signEvent(event, key)
  const result = await publishEvent(signed, RELAY)
  console.log('Publish result:', result)
  if (result.ok) {
    console.log('Solution event_id:', signed.id)
    
    // Mark question as solved
    const statusResp = await fetch(`${RELAY}/api/cold-start/events/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: QUESTION_EVENT_ID, status: 'solved' }),
    })
    const statusBody = await statusResp.text()
    console.log('Mark solved:', statusResp.status, statusBody)
  }
}

main().catch(console.error)
