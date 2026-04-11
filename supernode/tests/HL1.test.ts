// HL1 Test Suite: Letters to Agent
// TDD: POST stores letter, GET returns latest, letter never appears in network events.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db'
import { createApp } from '../src/app'
import { storeLetter, getLatestLetter } from '../src/agentxp/human-layer/letters'

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
    const pubkey = 'op-pubkey-hl1-' + Date.now()
    const res = await app.request(`/api/v1/operator/${pubkey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Next week is important. Be extra careful with financials.' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { ok: boolean; id: number }
    expect(body.ok).toBe(true)
    expect(typeof body.id).toBe('number')
  })

  // Test 2: GET returns latest letter with content and written_at
  it('GET /api/v1/operator/:pubkey/letter returns latest letter', async () => {
    const pubkey = 'op-pubkey-hl1b-' + Date.now()
    await app.request(`/api/v1/operator/${pubkey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ content: 'This week is critical. Be careful with financials.' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const get = await app.request(`/api/v1/operator/${pubkey}/letter`)
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
    const pubkey = 'op-pubkey-hl1c-' + Date.now()
    await app.request(`/api/v1/operator/${pubkey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Secret financial instructions for agent.' }),
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
    const pubkey = 'op-pubkey-hl1e-' + Date.now()
    const res = await app.request(`/api/v1/operator/${pubkey}/letter`, {
      method: 'POST',
      body: JSON.stringify({ content: '' }),
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
})
