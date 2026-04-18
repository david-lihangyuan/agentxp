/**
 * Smoke test: end-to-end feedback loop against a live relay.
 *
 * Exercises the four endpoints that make up the feedback loop — publish,
 * search, verify, pulse — using two ephemeral operators so that cross-op
 * scoring actually moves the pulse state forward.
 *
 * Usage:
 *   RELAY_URL=https://relay.agentxp.io npx tsx scripts/smoke-test-feedback-loop.ts
 *   RELAY_URL=http://localhost:3141    npx tsx scripts/smoke-test-feedback-loop.ts
 *
 * Exit codes: 0 all steps passed, 1 any step failed.
 */

import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
  type OperatorKey,
  type AgentKey,
  type SerendipEvent,
} from '../packages/protocol/src/index.ts'

const RELAY = process.env['RELAY_URL'] ?? 'https://relay.agentxp.io'

let failed = 0
function step(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed++
}

async function postEvent(event: SerendipEvent): Promise<{ status: number; body: any }> {
  const res = await fetch(`${RELAY}/api/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function getJson(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${RELAY}${path}`)
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

/** Search response items wrap the experience under `.experience`. */
function extractEventIds(body: any): string[] {
  const rows = [
    ...(Array.isArray(body?.precision) ? body.precision : []),
    ...(Array.isArray(body?.serendipity) ? body.serendipity : []),
  ]
  return rows
    .map((r: any) => r?.experience?.event_id ?? r?.event_id)
    .filter((id: unknown): id is string => typeof id === 'string')
}

async function waitForIndexing(
  targetEventId: string,
  searcherPubkey: string,
  marker: string,
  maxMs = 15000,
): Promise<void> {
  const q = encodeURIComponent(marker)
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const r = await getJson(`/api/v1/search?q=${q}&operator_pubkey=${searcherPubkey}`)
    if (extractEventIds(r.body).includes(targetEventId)) return
    await new Promise((res) => setTimeout(res, 1000))
  }
}

async function buildExperience(
  _op: OperatorKey,
  agent: AgentKey,
  marker: string,
): Promise<SerendipEvent> {
  const unsigned = createEvent(
    'intent.broadcast',
    {
      type: 'experience',
      data: {
        what: `smoke-test experience ${marker}`,
        tried: `synthetic probe run=${marker}`,
        outcome: 'succeeded',
        learned: `relay-feedback-loop probe ${marker} completed`,
      },
    },
    ['smoke-test', marker],
  )
  // signEvent sets pubkey=agent.publicKey and operator_pubkey=agent.delegatedBy
  // (== op.publicKey), so no field overrides needed here.
  return signEvent(unsigned, agent)
}

async function main(): Promise<void> {
  console.log(`[smoke] relay=${RELAY}`)
  console.log(`[smoke] generating two ephemeral operator keys`)

  const opA = await generateOperatorKey()
  const opB = await generateOperatorKey()
  const agentA = await delegateAgentKey(opA, 'smoke-a', 1)
  const agentB = await delegateAgentKey(opB, 'smoke-b', 1)
  const marker = `probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

  // Step 1 — Op A publishes an experience.
  const pubEvent = await buildExperience(opA, agentA, marker)
  const pub = await postEvent(pubEvent)
  step('publish', pub.status === 201 || pub.status === 200, `status=${pub.status} id=${pubEvent.id.slice(0, 16)}`)
  const targetEventId = pubEvent.id

  // Give the relay time to index + embed. Embedding is OpenAI-bound and
  // typically takes 2-5s on production; poll experience-search instead of
  // sleeping a flat long time.
  await waitForIndexing(targetEventId, opB.publicKey, marker)

  // Step 2 — Op B searches for it.
  const q = encodeURIComponent(marker)
  const search = await getJson(`/api/v1/search?q=${q}&operator_pubkey=${opB.publicKey}`)
  const eventIds = extractEventIds(search.body)
  step(
    'search hits target',
    eventIds.includes(targetEventId),
    `status=${search.status} total=${eventIds.length}`,
  )

  await new Promise((r) => setTimeout(r, 500))

  // Step 3 — Op A polls pulse. Search from a different operator should
  // have flipped state to at least `discovered`.
  const pulse1 = await getJson(`/api/v1/pulse?pubkey=${opA.publicKey}`)
  const highlights1 = Array.isArray(pulse1.body?.highlights) ? pulse1.body.highlights : []
  const afterSearch = highlights1.find((h: any) => h?.event_id === targetEventId)
  step('pulse shows discovery', !!afterSearch, `type=${afterSearch?.type ?? 'none'}`)

  // Step 4 — Op B publishes a cross-op verification.
  const verifyUnsigned = createEvent(
    'io.agentxp.verification',
    {
      type: 'verification',
      data: { target_event_id: targetEventId, outcome: 'confirmed' },
    },
    [],
  )
  const verifyEvt = await signEvent(verifyUnsigned, agentB)
  const ver = await postEvent(verifyEvt)
  step('verify accepted', ver.status === 201 || ver.status === 200, `status=${ver.status}`)

  await new Promise((r) => setTimeout(r, 1000))

  // Step 5 — Pulse should now show verified.
  const pulse2 = await getJson(`/api/v1/pulse?pubkey=${opA.publicKey}`)
  const highlights2 = Array.isArray(pulse2.body?.highlights) ? pulse2.body.highlights : []
  const afterVerify = highlights2.find(
    (h: any) => h?.event_id === targetEventId && (h?.type === 'verified' || h?.type === 'propagating'),
  )
  step('pulse shows verified', !!afterVerify, `type=${afterVerify?.type ?? 'none'}`)

  console.log(`\n[smoke] ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[smoke] fatal:', err)
  process.exit(1)
})
