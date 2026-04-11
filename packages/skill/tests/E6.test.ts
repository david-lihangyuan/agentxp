// E6 Test Suite: Heartbeat Batch Publish
// TDD: scan drafts/ → sanitize → classify → sign → publish to relay with retry.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  createDraft,
  runBatchPublish,
  getNextRetryDelay,
  readDraftFile,
} from '../src/publisher.js'

describe('E6: Heartbeat Batch Publish', () => {
  let testDir: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testDir = join(__dirname, '.tmp-e6-' + id)
    mkdirSync(join(testDir, 'drafts'), { recursive: true })
    mkdirSync(join(testDir, 'published'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('Publishable drafts are created correctly', async () => {
    const draftPath = await createDraft(
      {
        what: 'Docker DNS fix',
        tried: 'modified /etc/resolv.conf and restarted container',
        outcome: 'succeeded' as const,
        learned: 'docker container DNS cache cleared on restart, not on config reload',
      },
      testDir
    )
    expect(existsSync(draftPath)).toBe(true)
    const content = JSON.parse(readFileSync(draftPath, 'utf8'))
    expect(content.what).toBe('Docker DNS fix')
    expect(content.retry_count).toBe(0)
  })

  it('Successful publish moves draft to published/ with relay event ID', async () => {
    const draftPath = await createDraft(
      {
        what: 'Docker DNS fix',
        tried: 'modified /etc/resolv.conf and restarted container',
        outcome: 'succeeded' as const,
        learned: 'docker container DNS cache cleared on restart, not on config reload',
      },
      testDir
    )

    // Use a mock relay that always succeeds
    const result = await runBatchPublish(testDir, {
      relayUrl: 'wss://relay.agentxp.io',
      dryRun: true, // Simulates success without actual network
    })

    // Draft should be moved to published/
    expect(existsSync(draftPath)).toBe(false)
    const publishedFiles = readdirSync(join(testDir, 'published'))
    expect(publishedFiles.length).toBe(1)

    // Published file should have relay confirmation ID
    const published = JSON.parse(readFileSync(join(testDir, 'published', publishedFiles[0]), 'utf8'))
    expect(published.relay_event_id).toBeDefined()
  })

  it('Failed publish stays in drafts with retry metadata', async () => {
    const draftPath = await createDraft(
      {
        what: 'Test entry',
        tried: 'testing the publish retry mechanism with invalid relay',
        outcome: 'failed' as const,
        learned: 'retry mechanism preserves draft files on network failure',
      },
      testDir
    )

    await runBatchPublish(testDir, {
      relayUrl: 'wss://unreachable-relay.invalid',
      simulateFailure: true,
    })

    // Draft should still exist with retry metadata
    expect(existsSync(draftPath)).toBe(true)
    const draft = readDraftFile(draftPath)
    expect(draft.retry_count).toBe(1)
    expect(draft.last_attempt).toBeDefined()
  })

  it('Retry backoff doubles each time (15min → 30min → 60min cap)', () => {
    expect(getNextRetryDelay(1)).toBe(15 * 60 * 1000)
    expect(getNextRetryDelay(2)).toBe(30 * 60 * 1000)
    expect(getNextRetryDelay(3)).toBe(60 * 60 * 1000)
    expect(getNextRetryDelay(10)).toBe(60 * 60 * 1000) // capped
  })

  it('Draft files track retry_count and last_attempt fields', async () => {
    const draftPath = await createDraft(
      {
        what: 'Retry tracking test',
        tried: 'creating a draft and verifying metadata fields are tracked',
        outcome: 'succeeded' as const,
        learned: 'draft files contain retry_count and last_attempt for resilient publishing',
      },
      testDir
    )

    const draft = readDraftFile(draftPath)
    expect(draft).toHaveProperty('retry_count')
    expect(draft).toHaveProperty('last_attempt')
    expect(draft.retry_count).toBe(0)
  })

  it('Batch publish returns pulse events indicator', async () => {
    await createDraft(
      {
        what: 'Pulse test',
        tried: 'testing that publish returns pulse event info',
        outcome: 'succeeded' as const,
        learned: 'batch publish pulls pulse events back after successful publish',
      },
      testDir
    )

    const result = await runBatchPublish(testDir, {
      relayUrl: 'wss://relay.agentxp.io',
      dryRun: true,
    })

    expect(result).toBeDefined()
    expect(result.published).toBeGreaterThan(0)
    expect(result.pulseChecked).toBe(true)
  })
})
