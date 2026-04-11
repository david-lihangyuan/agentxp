// E2E Integration Test — Full AgentXP flow
// Tests the complete pipeline:
//   install skill → generate keys → create reflection → publish → relay receives → dashboard shows
//
// This test uses the supernode in-process (no network), exercising all layers together.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../../supernode/src/app.js'
import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
} from '../../packages/protocol/src/index.js'
import type { ExperiencePayload } from '../../packages/protocol/src/index.js'
import { runInstall } from '../../packages/skill/src/install.js'
import { createDraft } from '../../packages/skill/src/publisher.js'

// ---------------------------------------------------------------------------
// Shared state for the full pipeline flow
// ---------------------------------------------------------------------------

const state = {
  testDir: '',
  app: null as ReturnType<typeof createApp> | null,
  operatorPubkey: '',
}

beforeAll(async () => {
  // Create a temporary workspace directory for this test run
  state.testDir = join(tmpdir(), `agentxp-e2e-${Date.now()}`)
  mkdirSync(state.testDir, { recursive: true })

  // Create the supernode app with in-memory database
  state.app = createApp({ dbPath: ':memory:' })
})

afterAll(() => {
  // Clean up temp dir
  if (state.testDir && existsSync(state.testDir)) {
    rmSync(state.testDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// I1: End-to-End Integration Test
// ---------------------------------------------------------------------------

describe('I1: End-to-End Integration — install → reflect → publish → relay → dashboard', () => {

  it('Step 1: Install skill creates expected directory structure', async () => {
    // Run install (skip CLI symlink — no /usr/local/bin access in tests)
    await runInstall({
      workspaceDir: state.testDir,
      homeDir: join(state.testDir, 'home'),
      skipCliSymlink: true,
    })

    // Verify reflection directory was created
    expect(existsSync(join(state.testDir, 'reflection'))).toBe(true)
    expect(existsSync(join(state.testDir, 'reflection', 'mistakes.md'))).toBe(true)
    expect(existsSync(join(state.testDir, 'reflection', 'lessons.md'))).toBe(true)
    expect(existsSync(join(state.testDir, 'drafts'))).toBe(true)
    expect(existsSync(join(state.testDir, 'published'))).toBe(true)

    // Verify identity keys were generated
    expect(existsSync(join(state.testDir, 'home', '.agentxp', 'identity', 'operator.pub'))).toBe(true)
    expect(existsSync(join(state.testDir, 'home', '.agentxp', 'identity', 'operator.key'))).toBe(true)
  })

  it('Step 2: Generate protocol keys for signing events', async () => {
    const operatorKey = await generateOperatorKey()
    expect(operatorKey.publicKey).toHaveLength(64)
    expect(operatorKey.privateKey).toHaveLength(32)

    const agentKey = await delegateAgentKey(operatorKey, 'e2e-test-agent', 30)
    expect(agentKey.publicKey).toHaveLength(64)
    expect(agentKey.delegatedBy).toBe(operatorKey.publicKey)
  })

  it('Step 3: Create a reflection draft entry', async () => {
    const draftPath = await createDraft(
      {
        what: 'Docker DNS resolution failure in container',
        tried: 'Modified /etc/resolv.conf to use 8.8.8.8 as nameserver',
        outcome: 'succeeded',
        learned: 'Docker container DNS cache must be flushed by restarting the container after /etc/resolv.conf changes',
      },
      state.testDir
    )

    expect(existsSync(draftPath)).toBe(true)
    expect(draftPath).toContain('draft-')
    expect(draftPath).toContain('.json')
  })

  it('Step 4: Build, sign, and publish experience event to relay', async () => {
    // Generate fresh keys for this publish step
    const operatorKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(operatorKey, 'e2e-test-agent', 30)

    // Save the operator pubkey in shared state for later steps
    state.operatorPubkey = operatorKey.publicKey

    // Build an experience payload
    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'Docker DNS resolution failure in container',
        tried: 'Modified /etc/resolv.conf to use 8.8.8.8 as nameserver',
        outcome: 'succeeded',
        learned: 'Docker container DNS cache must be flushed by restarting the container after resolv.conf changes',
      },
    }

    // Create and sign the event using the protocol library
    const unsignedEvent = createEvent('intent.broadcast', payload, ['docker', 'dns', 'networking'])
    const signedEvent = await signEvent(unsignedEvent, agentKey)

    expect(signedEvent.id).toHaveLength(64)
    expect(signedEvent.sig).toHaveLength(128)
    expect(signedEvent.kind).toBe('intent.broadcast')

    // POST the experience event to the relay
    const res = await state.app!.request('/api/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedEvent),
    })

    // Relay returns 201 Created on successful event ingestion
    expect([200, 201]).toContain(res.status)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('ok', true)
  })

  it('Step 5: Relay stored the experience in its database', async () => {
    // Query dashboard/experiences to verify storage
    const res = await state.app!.request('/api/v1/dashboard/experiences')
    expect(res.status).toBe(200)

    const body = await res.json() as { experiences: unknown[] }
    expect(Array.isArray(body.experiences)).toBe(true)
    expect(body.experiences.length).toBeGreaterThan(0)

    // Verify the stored experience has correct fields
    const exp = body.experiences[0] as Record<string, unknown>
    expect(exp).toHaveProperty('what')
    expect(exp).toHaveProperty('outcome')
    expect(exp).toHaveProperty('learned')
  })

  it('Step 6: Dashboard API returns data for the operator', async () => {
    // Use the operator pubkey from shared state (set in step 4)
    const operatorPubkey = state.operatorPubkey
    expect(operatorPubkey).toHaveLength(64)

    // Query operator summary
    const summaryRes = await state.app!.request(
      `/api/v1/dashboard/operator/${operatorPubkey}/summary`
    )
    expect(summaryRes.status).toBe(200)

    const summary = await summaryRes.json() as Record<string, unknown>
    expect(summary).toHaveProperty('experience_count')
    expect(Number(summary.experience_count)).toBeGreaterThan(0)
  })

  it('Step 7: Health endpoint confirms relay is running', async () => {
    const res = await state.app!.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })

  it('Step 8: Multiple experiences accumulate correctly', async () => {
    // Publish a second experience for the same operator
    const operatorKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(operatorKey, 'e2e-test-agent-2', 30)

    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'npm install fails with ENOENT on package-lock.json',
        tried: 'Deleted node_modules and package-lock.json, ran npm install --legacy-peer-deps',
        outcome: 'succeeded',
        learned: 'When package-lock.json is corrupted, deleting it and reinstalling with --legacy-peer-deps resolves peer dep conflicts',
      },
    }

    const unsignedEvent = createEvent('intent.broadcast', payload, ['npm', 'node', 'install'])
    const signedEvent = await signEvent(unsignedEvent, agentKey)

    const res = await state.app!.request('/api/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedEvent),
    })

    expect([200, 201]).toContain(res.status)

    // Total experience count should have increased
    const dashRes = await state.app!.request('/api/v1/dashboard/experiences')
    const body = await dashRes.json() as { experiences: unknown[] }
    expect(body.experiences.length).toBeGreaterThanOrEqual(2)
  })
})

describe('I1: Protocol correctness in E2E flow', () => {
  it('signed events are verified by the relay before storage', async () => {
    // Tampered event should be rejected
    const operatorKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(operatorKey, 'tamper-test', 30)

    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'Test tampered event rejection by relay signature verification',
        tried: 'Submit an event with a valid signature for different content',
        outcome: 'failed',
        learned: 'Relay correctly rejects tampered events using Ed25519 signature verification',
      },
    }

    const unsignedEvent = createEvent('intent.broadcast', payload, ['test'])
    const signedEvent = await signEvent(unsignedEvent, agentKey)

    // Tamper with the payload after signing — signature is now invalid
    const tamperedEvent = {
      ...signedEvent,
      payload: {
        ...signedEvent.payload,
        data: {
          ...(signedEvent.payload as ExperiencePayload).data,
          what: 'TAMPERED: different content injected after signing',
        },
      },
    }

    const res = await state.app!.request('/api/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tamperedEvent),
    })

    // Relay should reject tampered events
    expect(res.status).toBe(400)
  })
})

describe('I1: Bundle size check — @serendip/protocol', () => {
  it('@serendip/protocol source is under 50KB', async () => {
    const { readdirSync, statSync } = await import('node:fs')

    const protocolSrcDir = join(
      new URL('.', import.meta.url).pathname,
      '../../packages/protocol/src'
    )

    // Sum up the source file sizes
    const files = readdirSync(protocolSrcDir).filter(f => f.endsWith('.ts'))
    let totalBytes = 0
    for (const file of files) {
      const stat = statSync(join(protocolSrcDir, file))
      totalBytes += stat.size
    }

    const KB50 = 50 * 1024
    expect(totalBytes).toBeLessThan(KB50)
  })
})
