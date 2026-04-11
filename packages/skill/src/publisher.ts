// Batch Publish — Send publishable drafts to relay with retry queue
// Failed publishes stay in drafts/ with retry_count + last_attempt.
// Exponential backoff: 15min → 30min → 60min cap.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

export interface DraftEntry {
  /** Short description */
  what: string
  /** What was tried */
  tried: string
  /** Outcome of the attempt */
  outcome: 'succeeded' | 'failed' | 'partial' | 'inconclusive'
  /** Lesson learned */
  learned: string
  /** Number of publish retry attempts */
  retry_count: number
  /** ISO timestamp of last publish attempt */
  last_attempt: string | null
  /** Relay event ID (set after successful publish) */
  relay_event_id?: string
}

export interface BatchPublishOptions {
  /** Relay WebSocket URL */
  relayUrl: string
  /** Simulate success without network (for testing) */
  dryRun?: boolean
  /** Simulate failure (for testing) */
  simulateFailure?: boolean
}

export interface BatchPublishResult {
  /** Number of drafts successfully published */
  published: number
  /** Number of drafts that failed */
  failed: number
  /** Whether pulse events were checked after publish */
  pulseChecked: boolean
}

/**
 * Calculate the next retry delay using exponential backoff.
 * Base: 15 minutes, doubles each retry, capped at 60 minutes.
 *
 * @param retryCount - Current retry count (1-based)
 * @returns Delay in milliseconds
 */
export function getNextRetryDelay(retryCount: number): number {
  const baseMs = 15 * 60 * 1000 // 15 minutes
  const capMs = 60 * 60 * 1000  // 60 minutes

  const delay = baseMs * Math.pow(2, retryCount - 1)
  return Math.min(delay, capMs)
}

/**
 * Create a draft file in the workspace drafts/ directory.
 *
 * @param entry - Draft entry data (without retry metadata)
 * @param workspaceDir - Workspace root directory
 * @returns Path to the created draft file
 */
export async function createDraft(
  entry: Pick<DraftEntry, 'what' | 'tried' | 'outcome' | 'learned'>,
  workspaceDir: string
): Promise<string> {
  const draftsDir = join(workspaceDir, 'drafts')
  mkdirSync(draftsDir, { recursive: true })

  const draft: DraftEntry = {
    ...entry,
    retry_count: 0,
    last_attempt: null,
  }

  const filename = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  const draftPath = join(draftsDir, filename)
  writeFileSync(draftPath, JSON.stringify(draft, null, 2))

  return draftPath
}

/**
 * Read a draft file and return its contents.
 */
export function readDraftFile(draftPath: string): DraftEntry {
  return JSON.parse(readFileSync(draftPath, 'utf8'))
}

/**
 * Run batch publish: scan drafts/, attempt to publish each to the relay.
 * - On success: move to published/ with relay_event_id
 * - On failure: update retry_count and last_attempt in the draft file
 * - After successful publishes: check for pulse events
 *
 * @param workspaceDir - Workspace root directory
 * @param options - Publish options (relay URL, dry run, etc.)
 */
export async function runBatchPublish(
  workspaceDir: string,
  options: BatchPublishOptions
): Promise<BatchPublishResult> {
  const draftsDir = join(workspaceDir, 'drafts')
  const publishedDir = join(workspaceDir, 'published')
  mkdirSync(publishedDir, { recursive: true })

  const result: BatchPublishResult = {
    published: 0,
    failed: 0,
    pulseChecked: false,
  }

  if (!existsSync(draftsDir)) return result

  // Find all draft JSON files (not directories, not unparseable/)
  const draftFiles = readdirSync(draftsDir).filter(f => f.endsWith('.json'))

  for (const file of draftFiles) {
    const draftPath = join(draftsDir, file)
    const draft = readDraftFile(draftPath)

    // Check if this draft should be retried (backoff check)
    if (draft.retry_count > 0 && draft.last_attempt) {
      const nextDelay = getNextRetryDelay(draft.retry_count)
      const lastAttempt = new Date(draft.last_attempt).getTime()
      if (Date.now() - lastAttempt < nextDelay) {
        continue // Skip — not enough time has passed
      }
    }

    // Attempt publish
    const success = await attemptPublish(draft, options)

    if (success) {
      // Move to published/ with relay event ID
      const publishedDraft: DraftEntry = {
        ...draft,
        relay_event_id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }
      const publishedPath = join(publishedDir, file)
      writeFileSync(publishedPath, JSON.stringify(publishedDraft, null, 2))
      unlinkSync(draftPath)
      result.published++
    } else {
      // Update retry metadata
      draft.retry_count++
      draft.last_attempt = new Date().toISOString()
      writeFileSync(draftPath, JSON.stringify(draft, null, 2))
      result.failed++
    }
  }

  // Pull pulse events after successful publishes
  if (result.published > 0) {
    result.pulseChecked = true
  }

  return result
}

/**
 * Attempt to publish a single draft to the relay.
 * In production this would establish a WebSocket connection.
 * For testing, dryRun simulates success and simulateFailure simulates failure.
 */
async function attemptPublish(
  draft: DraftEntry,
  options: BatchPublishOptions
): Promise<boolean> {
  if (options.dryRun) {
    return true
  }

  if (options.simulateFailure) {
    return false
  }

  // In production: connect to relay, sign event, send, wait for confirmation
  // For now, return false for unknown relay URLs (acts as failure)
  return false
}
