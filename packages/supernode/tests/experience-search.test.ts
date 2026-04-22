// Direct unit tests for experience-search. The integration in events.test.ts
// only verifies "happy path echoes through". These cover ranking, limit,
// Unicode, and the SQL LIKE metacharacter escape (regression: a user-supplied
// '%' or '_' used to be interpreted as a wildcard by SQLite).
import { describe, it, expect } from 'vitest'
import { openDb, type Db } from '../src/db.js'
import { search } from '../src/experience-search.js'

interface Seed {
  event_id: string
  pubkey?: string
  what?: string
  tried?: string
  outcome?: string
  learned?: string
  tags?: string[]
  created_at?: number
}

// Insert an events row and the matching experiences row in one call. The
// experiences table FKs event_id back to events, so we must seed both.
function seedExperience(db: Db, s: Seed): void {
  const pubkey = s.pubkey ?? 'a'.repeat(64)
  const created_at = s.created_at ?? 1_700_000_000
  const what = s.what ?? ''
  const tried = s.tried ?? ''
  const outcome = s.outcome ?? 'succeeded'
  const learned = s.learned ?? ''
  const tags = s.tags ?? []
  db.prepare(
    `INSERT INTO events
       (id, v, pubkey, operator_pubkey, created_at, kind, payload_json, tags_json, visibility, sig, received_at)
     VALUES (?, 1, ?, ?, ?, 'intent.broadcast', '{}', ?, 'public', ?, ?)`,
  ).run(s.event_id, pubkey, pubkey, created_at, JSON.stringify(tags), 'f'.repeat(128), created_at)
  db.prepare(
    `INSERT INTO experiences
       (event_id, pubkey, what, tried, outcome, learned, scope_json, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(s.event_id, pubkey, what, tried, outcome, learned, JSON.stringify(tags), created_at)
}

const id = (n: number): string => String(n).padStart(64, '0')

describe('experience-search: SQL LIKE metacharacter escape (regression)', () => {
  it("does not treat user-supplied '%' as a wildcard", () => {
    const db = openDb(':memory:')
    seedExperience(db, { event_id: id(1), what: 'literal percent 100% value' })
    seedExperience(db, { event_id: id(2), what: 'no percent here' })

    // Query '100%foo' must only match the literal substring '100%foo',
    // which is absent. Without escaping, SQLite's LIKE would treat '%' as
    // "any sequence" and match both rows containing '100' + anything.
    const hits = search(db, '100%foo', 10)
    expect(hits).toHaveLength(0)
  })

  it("does not treat user-supplied '_' as a single-char wildcard", () => {
    const db = openDb(':memory:')
    seedExperience(db, { event_id: id(1), what: 'abc' })
    seedExperience(db, { event_id: id(2), what: 'a_c literal underscore' })

    // Query 'a_c' without escaping would match both 'abc' and 'a_c'.
    // With escaping, only the row containing the literal 'a_c' matches.
    const hits = search(db, 'a_c', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.event_id).toBe(id(2))
  })

  it('treats a lone backslash as a literal character', () => {
    const db = openDb(':memory:')
    seedExperience(db, { event_id: id(1), what: 'path C:\\Users\\x' })

    // The backslash is the ESCAPE char; bare '\\' in input must still
    // round-trip to a literal-backslash search without SQLite error.
    const hits = search(db, 'C:\\Users', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.event_id).toBe(id(1))
  })
})

describe('experience-search: ranking and limit', () => {
  it('ranks by score DESC (more matching columns wins)', () => {
    const db = openDb(':memory:')
    // id(1): matches 'docker' in 1 column (what only)
    seedExperience(db, { event_id: id(1), what: 'docker tip', created_at: 1000 })
    // id(2): matches 'docker' in 3 columns (what + tried + learned)
    seedExperience(db, {
      event_id: id(2),
      what: 'docker tip',
      tried: 'tried docker restart',
      learned: 'docker needed a reload',
      created_at: 900,
    })

    const hits = search(db, 'docker', 10)
    expect(hits.map((h) => h.event_id)).toEqual([id(2), id(1)])
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
  })

  it('ties are broken by created_at DESC (newer first)', () => {
    const db = openDb(':memory:')
    seedExperience(db, { event_id: id(1), what: 'docker A', created_at: 1000 })
    seedExperience(db, { event_id: id(2), what: 'docker B', created_at: 2000 })
    seedExperience(db, { event_id: id(3), what: 'docker C', created_at: 1500 })

    const hits = search(db, 'docker', 10)
    expect(hits.map((h) => h.event_id)).toEqual([id(2), id(3), id(1)])
  })

  it('respects the limit parameter', () => {
    const db = openDb(':memory:')
    for (let i = 1; i <= 5; i++) {
      seedExperience(db, { event_id: id(i), what: `docker ${i}`, created_at: 1000 + i })
    }
    const hits = search(db, 'docker', 2)
    expect(hits).toHaveLength(2)
  })

  it('score is in [0, 1] (fraction of columns matched)', () => {
    const db = openDb(':memory:')
    seedExperience(db, {
      event_id: id(1),
      what: 'docker',
      tried: 'docker',
      learned: 'docker',
      tags: ['docker'],
    })
    const hits = search(db, 'docker', 10)
    expect(hits[0]!.score).toBe(1)
  })
})

describe('experience-search: query edge cases', () => {
  it('is case-insensitive', () => {
    const db = openDb(':memory:')
    seedExperience(db, { event_id: id(1), what: 'Docker Networking' })
    const hits = search(db, 'DOCKER', 10)
    expect(hits).toHaveLength(1)
  })

  it('matches Unicode substrings', () => {
    const db = openDb(':memory:')
    seedExperience(db, { event_id: id(1), what: '容器重启后 DNS 缓存失效' })
    const hits = search(db, '容器', 10)
    expect(hits).toHaveLength(1)
  })

  it('tags are matched through the tags_json column (free substring, caveat documented)', () => {
    const db = openDb(':memory:')
    seedExperience(db, { event_id: id(1), tags: ['docker'] })
    const hits = search(db, 'docker', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.experience.tags).toEqual(['docker'])
  })

  it('returns empty for no matches (no rows inserted by empty result)', () => {
    const db = openDb(':memory:')
    seedExperience(db, { event_id: id(1), what: 'docker' })
    const hits = search(db, 'kubernetes', 10)
    expect(hits).toHaveLength(0)
  })
})
