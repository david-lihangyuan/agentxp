// Cold Start Store Tests
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { ColdStartStore } from '../src/agentxp/cold-start-store'
import type { SerendipEvent } from '@serendip/protocol'

function makeEvent(overrides: Partial<SerendipEvent> = {}): SerendipEvent {
  return {
    v: 1,
    id: 'aaaa' + Math.random().toString(36).slice(2),
    pubkey: 'pubkey01',
    created_at: Math.floor(Date.now() / 1000),
    kind: 'intent.question',
    payload: { type: 'question', data: { text: 'how do I fix this?' } } as SerendipEvent['payload'],
    tags: ['lang:ts'],
    visibility: 'public',
    operator_pubkey: 'operatorpubkey01',
    sig: 'sig01',
    ...overrides,
  }
}

describe('ColdStartStore', () => {
  let db: Database.Database
  let store: ColdStartStore

  beforeEach(() => {
    db = new Database(':memory:')
    store = new ColdStartStore(db)
  })

  it('stores an intent.question event', () => {
    const event = makeEvent({ kind: 'intent.question' })
    const result = store.store(event)
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()

    const questions = store.listQuestions()
    expect(questions).toHaveLength(1)
    expect(questions[0].event_id).toBe(event.id)
    expect(questions[0].kind).toBe('intent.question')
  })

  it('stores an experience.solution event', () => {
    const event = makeEvent({ kind: 'experience.solution' })
    const result = store.store(event)
    expect(result.ok).toBe(true)

    const solutions = store.listSolutions()
    expect(solutions).toHaveLength(1)
    expect(solutions[0].kind).toBe('experience.solution')
  })

  it('stores verification.pass and verification.fail events', () => {
    const pass = makeEvent({ kind: 'verification.pass' })
    const fail = makeEvent({ kind: 'verification.fail' })
    expect(store.store(pass).ok).toBe(true)
    expect(store.store(fail).ok).toBe(true)
  })

  it('rejects an unsupported kind', () => {
    const event = makeEvent({ kind: 'intent.broadcast' })
    const result = store.store(event)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('unsupported kind')
  })

  it('is idempotent — storing duplicate event_id returns ok:true', () => {
    const event = makeEvent({ kind: 'intent.question' })
    const first = store.store(event)
    const second = store.store(event)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)

    // Only one row in the table
    const questions = store.listQuestions()
    expect(questions).toHaveLength(1)
  })

  it('listQuestions filters by status', () => {
    const pending = makeEvent({ kind: 'intent.question' })
    store.store(pending)

    // Manually update status to 'solved' for a second event
    const solved = makeEvent({ kind: 'intent.question', id: 'bbbb-solved' })
    store.store(solved)
    db.prepare("UPDATE cold_start_events SET status = 'solved' WHERE event_id = ?").run(solved.id)

    const pendingList = store.listQuestions({ status: 'pending' })
    expect(pendingList).toHaveLength(1)
    expect(pendingList[0].event_id).toBe(pending.id)

    const solvedList = store.listQuestions({ status: 'solved' })
    expect(solvedList).toHaveLength(1)
    expect(solvedList[0].event_id).toBe(solved.id)

    const all = store.listQuestions()
    expect(all).toHaveLength(2)
  })

  it('listQuestions respects limit', () => {
    for (let i = 0; i < 5; i++) {
      store.store(makeEvent({ kind: 'intent.question', id: `qid-${i}` }))
    }
    const limited = store.listQuestions({ limit: 3 })
    expect(limited).toHaveLength(3)
  })

  it('listSolutions filters by status', () => {
    const s1 = makeEvent({ kind: 'experience.solution', id: 'sol-1' })
    const s2 = makeEvent({ kind: 'experience.solution', id: 'sol-2' })
    store.store(s1)
    store.store(s2)
    db.prepare("UPDATE cold_start_events SET status = 'verified' WHERE event_id = ?").run(s2.id)

    const pending = store.listSolutions({ status: 'pending' })
    expect(pending).toHaveLength(1)
    expect(pending[0].event_id).toBe(s1.id)
  })
})
