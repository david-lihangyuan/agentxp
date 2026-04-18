// D3 Test Suite: Three-Layer Visibility
// TDD: operator-level, agent-level, experience-level overrides; priority chain.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import { runMigrations } from '../src/db'
import { VisibilityManager } from '../src/agentxp/visibility'
import { classify } from '../src/agentxp/classify'

describe('D3: Three-Layer Visibility', () => {
  let db: Database.Database
  let vm: VisibilityManager

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    vm = new VisibilityManager(db)
  })

  it('operator-level override forces private', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent-1', 90)

    vm.setOperatorVisibility(opKey.publicKey, 'private')

    // No experience-level or agent-level override → falls through to operator
    const visibility = vm.resolveVisibility(
      null, // no experience-level override
      agentKey.publicKey,
      opKey.publicKey,
      'public' // auto-classification fallback
    )
    expect(visibility).toBe('private')
  })

  it('agent-level overrides operator', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent-1', 90)

    vm.setOperatorVisibility(opKey.publicKey, 'public')
    vm.setAgentVisibility(agentKey.publicKey, 'private')

    const visibility = vm.resolveVisibility(
      null, // no experience-level override
      agentKey.publicKey,
      opKey.publicKey,
      'public'
    )
    expect(visibility).toBe('private')
  })

  it('experience-level overrides agent', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent-1', 90)

    vm.setOperatorVisibility(opKey.publicKey, 'private')
    vm.setAgentVisibility(agentKey.publicKey, 'private')

    const visibility = vm.resolveVisibility(
      'public', // experience-level override
      agentKey.publicKey,
      opKey.publicKey,
      'private'
    )
    expect(visibility).toBe('public')
  })

  it('priority: experience > agent > operator > auto-classification', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent-1', 90)

    vm.setOperatorVisibility(opKey.publicKey, 'private')
    vm.setAgentVisibility(agentKey.publicKey, 'private')

    // Experience-level wins over everything
    const visibility = vm.resolveVisibility(
      'public',
      agentKey.publicKey,
      opKey.publicKey,
      'private'
    )
    expect(visibility).toBe('public')
  })

  it('falls through to auto-classification when no overrides set', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent-1', 90)

    // No operator, agent, or experience override → uses fallback
    const visibility = vm.resolveVisibility(
      null,
      agentKey.publicKey,
      opKey.publicKey,
      'public' // auto-classification result
    )
    expect(visibility).toBe('public')
  })

  it('auto-classification as fallback uses classify()', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent-1', 90)

    // Simulate auto-classification providing the fallback
    const autoClass = classify({
      tried: 'docker run nginx',
      learned: 'works',
      tags: ['docker'],
    })
    expect(autoClass).toBe('public')

    const visibility = vm.resolveVisibility(
      null,
      agentKey.publicKey,
      opKey.publicKey,
      autoClass as 'public' | 'private'
    )
    expect(visibility).toBe('public')
  })

  it('getOperatorVisibility returns null when not set', async () => {
    const opKey = await generateOperatorKey()
    expect(vm.getOperatorVisibility(opKey.publicKey)).toBeNull()
  })

  it('getAgentVisibility returns null when not set', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent-1', 90)
    expect(vm.getAgentVisibility(agentKey.publicKey)).toBeNull()
  })

  it('setOperatorVisibility is idempotent (upsert)', async () => {
    const opKey = await generateOperatorKey()
    vm.setOperatorVisibility(opKey.publicKey, 'public')
    expect(vm.getOperatorVisibility(opKey.publicKey)).toBe('public')

    vm.setOperatorVisibility(opKey.publicKey, 'private')
    expect(vm.getOperatorVisibility(opKey.publicKey)).toBe('private')
  })

  it('setAgentVisibility is idempotent (upsert)', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent-1', 90)

    vm.setAgentVisibility(agentKey.publicKey, 'public')
    expect(vm.getAgentVisibility(agentKey.publicKey)).toBe('public')

    vm.setAgentVisibility(agentKey.publicKey, 'private')
    expect(vm.getAgentVisibility(agentKey.publicKey)).toBe('private')
  })

  it('operator private + no agent + no experience = private', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent-1', 90)

    vm.setOperatorVisibility(opKey.publicKey, 'private')

    const vis = vm.resolveVisibility(null, agentKey.publicKey, opKey.publicKey, 'public')
    expect(vis).toBe('private')
  })

  it('multiple agents under same operator can have different visibility', async () => {
    const opKey = await generateOperatorKey()
    const agent1 = await delegateAgentKey(opKey, 'agent-1', 90)
    const agent2 = await delegateAgentKey(opKey, 'agent-2', 90)

    vm.setAgentVisibility(agent1.publicKey, 'private')
    vm.setAgentVisibility(agent2.publicKey, 'public')

    const vis1 = vm.resolveVisibility(null, agent1.publicKey, opKey.publicKey, 'public')
    const vis2 = vm.resolveVisibility(null, agent2.publicKey, opKey.publicKey, 'public')

    expect(vis1).toBe('private')
    expect(vis2).toBe('public')
  })
})

describe('D3: Visibility HTTP API', () => {
  it('GET /api/v1/visibility/:operator_pubkey returns default public when not set', async () => {
    const { createApp } = await import('../src/app')
    const app = createApp({ dbPath: ':memory:' })

    const opKey = 'a'.repeat(64)
    const res = await app.request(`/api/v1/visibility/${opKey}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { default_visibility: string }
    expect(body.default_visibility).toBe('public')
  })

  it('PATCH /api/v1/visibility/:operator_pubkey sets operator visibility to private', async () => {
    const { createApp } = await import('../src/app')
    const app = createApp({ dbPath: ':memory:' })

    const opKey = 'b'.repeat(64)
    const res = await app.request(`/api/v1/visibility/${opKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ default_visibility: 'private' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; default_visibility: string }
    expect(body.ok).toBe(true)
    expect(body.default_visibility).toBe('private')
  })

  it('GET /api/v1/visibility/:operator_pubkey returns updated value after PATCH', async () => {
    const { createApp } = await import('../src/app')
    const app = createApp({ dbPath: ':memory:' })

    const opKey = 'c'.repeat(64)
    await app.request(`/api/v1/visibility/${opKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ default_visibility: 'private' }),
      headers: { 'content-type': 'application/json' },
    })

    const res = await app.request(`/api/v1/visibility/${opKey}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { default_visibility: string }
    expect(body.default_visibility).toBe('private')
  })

  it('PATCH /api/v1/visibility/:operator_pubkey rejects invalid visibility value', async () => {
    const { createApp } = await import('../src/app')
    const app = createApp({ dbPath: ':memory:' })

    const opKey = 'd'.repeat(64)
    const res = await app.request(`/api/v1/visibility/${opKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ default_visibility: 'secret' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/v1/visibility/:operator_pubkey sets visibility to public', async () => {
    const { createApp } = await import('../src/app')
    const app = createApp({ dbPath: ':memory:' })

    const opKey = 'e'.repeat(64)
    // First set private
    await app.request(`/api/v1/visibility/${opKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ default_visibility: 'private' }),
      headers: { 'content-type': 'application/json' },
    })
    // Then update to public
    const res = await app.request(`/api/v1/visibility/${opKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ default_visibility: 'public' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)

    const getRes = await app.request(`/api/v1/visibility/${opKey}`)
    const body = await getRes.json() as { default_visibility: string }
    expect(body.default_visibility).toBe('public')
  })
})
