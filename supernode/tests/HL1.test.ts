// HL1 Test Suite: Letters to Agent
// TDD: POST stores letter, GET returns latest, letter never appears in network events.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { generateOperatorKey, createEvent, signEvent } from '@serendip/protocol'
import type { OperatorKey, AgentKey, SerendipEvent, SerendipKind } from '@serendip/protocol'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'
import { storeLetter, getLatestLetter } from '../src/agentxp/human-layer/letters'

// Build a SerendipEvent signed directly by the operator, as required by the
// verifyOperatorEvent gate on POST /operator/:pubkey/letter.
async function signLetterEvent(
  opKey: OperatorKey,
  content: string,
): Promise<SerendipEvent> {
  const opAsAgent: AgentKey = {
    publicKey: opKey.publicKey,
    privateKey: opKey.privateKey,
    delegatedBy: opKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
  }
  const unsigned = createEvent('operator.letter' as SerendipKind, { type: 'operator.letter', data: { content } }, [])
  const withVis = { ...unsigned, visibility: 'private' as const }
  return signEvent(withVis, opAsAgent)
}

describe('HL1: Letters to Agent', () => {
  let app: ReturnType<typeof createApp>
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    app = createApp({ db })
  })

  // Test 1: POST saves letter and returns 201
  it('POST /api/v1/operator/:pubkey/letter stores a letter', async () => {
    const opKey = await generateOperatorKey()
    const event = await signLetterEvent(opKey, 'Next week is important. Be extra careful with financials.')
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { ok: boolean; id: number }
    expect(body.ok).toBe(true)
    expect(typeof body.id).toBe('number')
  })

  // Test 2: GET returns latest letter with content and written_at
  it('GET /api/v1/operator/:pubkey/letter returns latest letter', async () => {
    const opKey = await generateOperatorKey()
    const event = await signLetterEvent(opKey, 'This week is critical. Be careful with financials.')
    await app.request(`/api/v1/operator/${opKey.publicKey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      headers: { 'Content-Type': 'application/json' },
    })

    const get = await app.request(`/api/v1/operator/${opKey.publicKey}/letter`)
    expect(get.status).toBe(200)
    const body = await get.json() as { content: string; written_at: string }
    expect(body.content).toContain('financials')
    expect(body.written_at).toBeDefined()
    expect(typeof body.written_at).toBe('string')
  })

  // Test 3: GET returns 404 when no letter exists
  it('GET /api/v1/operator/:pubkey/letter returns 404 when no letter exists', async () => {
    const pubkey = 'op-no-letter-' + Date.now()
    const res = await app.request(`/api/v1/operator/${pubkey}/letter`)
    expect(res.status).toBe(404)
  })

  // Test 4: Letter stored locally only — never appears in protocol events table
  it('letter content is never stored in protocol events table', async () => {
    const opKey = await generateOperatorKey()
    const event = await signLetterEvent(opKey, 'Secret financial instructions for agent.')
    await app.request(`/api/v1/operator/${opKey.publicKey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      headers: { 'Content-Type': 'application/json' },
    })

    // No event with kind='operator.letter' should exist in events table
    const events = db
      .prepare("SELECT * FROM events WHERE kind = 'operator.letter'")
      .all()
    expect(events.length).toBe(0)

    // Also verify content is NOT in any events row
    const allEvents = db.prepare('SELECT payload FROM events').all() as Array<{ payload: string }>
    for (const ev of allEvents) {
      expect(ev.payload).not.toContain('Secret financial instructions')
    }
  })

  // Test 5: GET latest letter returns the most recently posted one
  it('GET returns the most recent letter when multiple exist', async () => {
    const pubkey = 'op-pubkey-hl1d-' + Date.now()

    // Post two letters
    storeLetter(db, pubkey, 'First letter content')
    // Small delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 10))
    storeLetter(db, pubkey, 'Second and latest letter content')

    const letter = getLatestLetter(db, pubkey)
    expect(letter).not.toBeNull()
    expect(letter!.content).toContain('Second and latest')
  })

  // Test 6: POST with empty content returns 400
  it('POST with empty content returns 400', async () => {
    const opKey = await generateOperatorKey()
    const event = await signLetterEvent(opKey, '')
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  // Test 7: storeLetter() function works directly
  it('storeLetter() stores a letter in operator_letters table', () => {
    const pubkey = 'op-direct-' + Date.now()
    const result = storeLetter(db, pubkey, 'Direct letter content')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.id).toBe('number')
    }

    const row = db
      .prepare('SELECT * FROM operator_letters WHERE operator_pubkey = ?')
      .get(pubkey) as { content: string; operator_pubkey: string } | undefined
    expect(row).toBeDefined()
    expect(row!.content).toBe('Direct letter content')
  })

  // Test 8: POST without event envelope returns 400
  it('POST without event envelope returns 400', async () => {
    const opKey = await generateOperatorKey()
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ content: 'plain content, no envelope' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  // Test 9: POST with event signed by a different operator returns 401
  it('POST with pubkey mismatch returns 401', async () => {
    const opKey = await generateOperatorKey()
    const otherKey = await generateOperatorKey()
    const event = await signLetterEvent(otherKey, 'forged letter')
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ event }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  // Test 10: POST with tampered signature returns 401
  it('POST with tampered signature returns 401', async () => {
    const opKey = await generateOperatorKey()
    const event = await signLetterEvent(opKey, 'original content')
    const tampered = { ...event, sig: event.sig.replace(/.$/, (c) => (c === '0' ? '1' : '0')) }
    const res = await app.request(`/api/v1/operator/${opKey.publicKey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ event: tampered }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })
})
