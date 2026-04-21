import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { startInMemoryRelay, registerOperatorAndAgent } from './helpers.js'
import {
  captureInSessionDraft,
  captureEndOfSessionDraft,
  openStoreForTarget,
  reflect,
} from '../src/reflect.js'
import { ensureOperatorKey, ensureAgentKey } from '../src/identity.js'

function freshDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function seedWorkspace(relayOrigin: string): Promise<{ target: string; idRoot: string }> {
  const target = freshDir('agentxp-skill-refl-')
  const idRoot = freshDir('agentxp-skill-id-')
  mkdirSync(join(target, '.agentxp'), { recursive: true })
  writeFileSync(
    join(target, '.agentxp', 'config.json'),
    JSON.stringify({ relay_url: relayOrigin, agent_id: 'default' }),
  )
  return { target, idRoot }
}

const draft = {
  what: 'Reflection capture in-session',
  tried: 'Invoked captureInSessionDraft after 5 tool calls',
  outcome: 'succeeded' as const,
  learned: 'Tier-1 staging never talks to the relay on its own',
  tags: ['tier1', 'docker'],
}

describe('Tier 1 — in-session capture (ADR-001; MILESTONES M3 check 3)', () => {
  let target: string
  let idRoot: string

  beforeEach(async () => {
    const relay = startInMemoryRelay()
    const seeded = await seedWorkspace(relay.origin)
    target = seeded.target
    idRoot = seeded.idRoot
    await ensureOperatorKey(idRoot)
  })

  it('stages an in-session draft without reaching the relay', () => {
    const store = openStoreForTarget(target)
    try {
      const row = captureInSessionDraft(store, draft)
      expect(row.tier).toBe('in-session')
      expect(row.data.what).toBe(draft.what)
      expect(row.retry_count).toBe(0)
      expect(store.listAll().length).toBe(1)
    } finally {
      store.close()
    }
  })

  it('rejects drafts missing required fields', () => {
    const store = openStoreForTarget(target)
    try {
      expect(() => captureInSessionDraft(store, { ...draft, what: '' })).toThrowError(
        /what is required/,
      )
    } finally {
      store.close()
    }
    void idRoot
  })
})

describe('Tier 2 — end-of-session reflect (ADR-001; MILESTONES M3 check 2 & 3)', () => {
  let target: string
  let idRoot: string

  beforeEach(async () => {
    const seeded = await seedWorkspace('http://relay.test')
    target = seeded.target
    idRoot = seeded.idRoot
  })

  it('publishes staged drafts to a running relay and clears them on 200', async () => {
    const relay = startInMemoryRelay()

    const operator = await ensureOperatorKey(idRoot)
    const agent = await ensureAgentKey(operator, 'default', 30, idRoot)
    await registerOperatorAndAgent(relay, operator, agent)

    // rewrite config to hit the live in-memory relay origin
    writeFileSync(
      join(target, '.agentxp', 'config.json'),
      JSON.stringify({ relay_url: relay.origin, agent_id: 'default' }),
    )

    const store = openStoreForTarget(target)
    captureInSessionDraft(store, draft)
    captureEndOfSessionDraft(store, {
      ...draft,
      what: 'End-of-session summary',
      tried: 'Reviewed session after CLI exit',
    })
    store.close()

    const outcome = await reflect({
      targetDir: target,
      identityRoot: idRoot,
      fetch: relay.fetch,
    })
    expect(outcome.published.length).toBe(2)
    expect(outcome.retry.length).toBe(0)
    expect(outcome.rejected.length).toBe(0)

    // Check 2 echo via /search
    const search = await relay.fetch(`${relay.origin}/api/v1/search?q=end-of-session`)
    const body = (await search.json()) as { results: Array<{ event_id: string }> }
    expect(body.results.length).toBeGreaterThan(0)

    // drafts store cleared
    const s2 = openStoreForTarget(target)
    expect(s2.listAll().length).toBe(0)
    s2.close()
  })

  it('retains staged drafts when the relay returns 503 and retries later', async () => {
    const operator = await ensureOperatorKey(idRoot)
    await ensureAgentKey(operator, 'default', 30, idRoot)

    const store = openStoreForTarget(target)
    captureEndOfSessionDraft(store, draft)
    store.close()

    const flakyFetch: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'upstream_unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })

    const outcome = await reflect({
      targetDir: target,
      identityRoot: idRoot,
      fetch: flakyFetch,
    })
    expect(outcome.retry.length).toBe(1)
    expect(outcome.published.length).toBe(0)
    expect(outcome.rejected.length).toBe(0)

    const s2 = openStoreForTarget(target)
    const rows = s2.listAll()
    expect(rows.length).toBe(1)
    expect(rows[0]?.retry_count).toBe(1)
    s2.close()
  })

  it('exits with OperatorKeyMissingError when no identity is present', async () => {
    const missingRoot = freshDir('agentxp-skill-missing-')
    await expect(reflect({ targetDir: target, identityRoot: missingRoot })).rejects.toThrowError(
      /operator key not found/,
    )
  })
})
