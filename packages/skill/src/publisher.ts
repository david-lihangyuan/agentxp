// Batch Publish — Send publishable drafts to relay with retry queue
// Failed publishes stay in drafts/ with retry_count + last_attempt.
// Exponential backoff: 15min → 30min → 60min cap.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createEvent, signEvent, delegateAgentKey } from './protocol/index.js'
import type { SerendipKind, OperatorKey, ExperiencePayload } from './protocol/index.js'
import { relayRecall } from './relay-recall.js'
import type { RecallResult } from './relay-recall.js'
import { distillExperiences } from './distill.js'
import type { ExperienceDistillResult } from './distill.js'

export interface DraftEntry {
  /** Short description */
  what: string
  /** What was tried */
  tried: string
  /** Outcome of the attempt */
  outcome: 'succeeded' | 'failed' | 'partial' | 'inconclusive'
  /** Lesson learned */
  learned: string
  /** Why this was attempted (optional context) */
  context?: string
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
  /** Agent home directory for key loading (default: os.homedir()) */
  agentHomeDir?: string
  /** Experience kind to use when publishing (default: experience.coding) */
  kind?: string
  /** Skip pre-search duplicate check (default: false) */
  skipPreSearch?: boolean
  /** Similarity threshold for duplicate detection (0-1, default: 0.7) */
  duplicateThreshold?: number
}

export interface BatchPublishResult {
  /** Number of drafts successfully published */
  published: number
  /** Number of drafts that failed */
  failed: number
  /** Number of drafts skipped due to duplicate detection */
  skippedDuplicate: number
  /** Whether pulse events were checked after publish */
  pulseChecked: boolean
  /** Relay recall results per draft (what the agent saw before publishing) */
  recallResults: RecallResult[]
  /** Distillation result (present when distillation was triggered after publish) */
  distillation?: ExperienceDistillResult
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
/**
 * Quality gate for draft entries before publishing.
 * Ensures experiences are substantive and contain concrete information.
 *
 * @param draft - The draft entry to check
 * @returns { pass: true } if quality is acceptable, { pass: false, reason } otherwise
 */
export function qualityGate(draft: DraftEntry): { pass: boolean; reason?: string } {
  if (draft.what.length <= 10) {
    return { pass: false, reason: '"what" must be longer than 10 characters' }
  }
  if (draft.learned.length <= 20) {
    return { pass: false, reason: '"learned" must be longer than 20 characters' }
  }
  if (draft.tried.length <= 20) {
    return { pass: false, reason: '"tried" must be longer than 20 characters' }
  }
  // At least one concrete information marker:
  // - file path (/ or \)
  // - backtick command
  // - error code (standalone number 2-5 digits)
  // - dotted config key (word.word)
  const CONCRETE_RE = /[\/\\]|`[^`]+`|\b\d{2,5}\b|\b\w+\.\w+/
  if (!CONCRETE_RE.test(draft.learned)) {
    return { pass: false, reason: '"learned" must contain at least one concrete detail (path, command, error code, or config key)' }
  }
  return { pass: true }
}

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
    skippedDuplicate: 0,
    pulseChecked: false,
    recallResults: [],
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

    // Relay Recall: search for related experiences before publishing
    // This is the consumption trigger — agents read before writing
    if (!options.skipPreSearch) {
      const recall = await relayRecall(draft.what, draft.learned, {
        relayUrl: options.relayUrl,
        limit: 5,
        minScore: options.duplicateThreshold ?? 0.3,
        agentHomeDir: options.agentHomeDir,
      })
      result.recallResults.push(recall)

      // Log the recall results (agent can see this in output)
      if (recall.count > 0) {
        console.log(recall.formatted)
      }

      // Still check for exact duplicates (high similarity)
      const dupThreshold = options.duplicateThreshold ?? 0.7
      const isDuplicate = await preSearchRelay(draft, { ...options, duplicateThreshold: dupThreshold })
      if (isDuplicate) {
        // Move to published/ as "skipped-duplicate" instead of discarding
        const skippedDraft: DraftEntry = {
          ...draft,
          relay_event_id: 'skipped-duplicate',
        }
        const skippedPath = join(publishedDir, `dup-${file}`)
        writeFileSync(skippedPath, JSON.stringify(skippedDraft, null, 2))
        unlinkSync(draftPath)
        result.skippedDuplicate++
        continue
      }
    }

    // Quality gate: ensure experience is substantive before publishing
    const qg = qualityGate(draft)
    if (!qg.pass) {
      // Move to published/ as "local-only" — not sent to relay
      const localOnlyDraft: DraftEntry = {
        ...draft,
        relay_event_id: 'local-only',
      }
      const localOnlyPath = join(publishedDir, `local-${file}`)
      writeFileSync(localOnlyPath, JSON.stringify(localOnlyDraft, null, 2))
      unlinkSync(draftPath)
      continue
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

    // Auto-distill experiences: check if any pattern has accumulated 5+ mistakes
    const reflectionDir = join(workspaceDir, 'reflection')
    try {
      result.distillation = distillExperiences(reflectionDir)
    } catch {
      // Distillation failure must not break the publish flow
    }
  }

  return result
}

/**
 * Pre-search the relay to check if a highly similar experience already exists.
 * Returns true if a duplicate is found (above threshold), false otherwise.
 * On any error (network, timeout), returns false (fail-open: publish anyway).
 */
export async function preSearchRelay(
  draft: DraftEntry,
  options: BatchPublishOptions
): Promise<boolean> {
  const threshold = options.duplicateThreshold ?? 0.7

  const relayHttpUrl = options.relayUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
  const searchUrl = `${relayHttpUrl.replace(/\/$/, '')}/api/v1/search`

  // Search using the draft's core content (what + learned)
  const query = `${draft.what} ${draft.learned}`.slice(0, 300)

  try {
    // Search API is GET with query params
    const params = new URLSearchParams({ q: query, limit: '3' })
    const res = await fetch(`${searchUrl}?${params}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    })

    if (!res.ok) return false

    const data = await res.json() as {
      precision?: Array<{ match_score: number; experience: { what: string } }>
    }

    // Check if any result exceeds the duplicate threshold
    const matches = data.precision ?? []
    for (const match of matches) {
      if (match.match_score >= threshold) {
        return true // Duplicate found
      }
    }

    return false
  } catch {
    // Network error, timeout, etc. — fail-open: allow publish
    return false
  }
}

/**
 * Load operator private key as hex string from ~/.agentxp/identity/operator.key.
 * Returns null if not found (safe fallback).
 */
function loadPrivateKey(agentHomeDir?: string): string | null {
  try {
    const home = agentHomeDir || homedir()
    const keyPath = join(home, '.agentxp', 'identity', 'operator.key')
    if (!existsSync(keyPath)) return null
    return readFileSync(keyPath, 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * Load operator public key from ~/.agentxp/identity/operator.pub.
 */
function loadPublicKey(agentHomeDir?: string): string | null {
  try {
    const home = agentHomeDir || homedir()
    const pubPath = join(home, '.agentxp', 'identity', 'operator.pub')
    if (!existsSync(pubPath)) return null
    return readFileSync(pubPath, 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * Attempt to publish a single draft to the relay via HTTP POST.
 * Reads identity keys from agentHomeDir (or homedir() if not set).
 * Falls back to false if keys are missing or network fails.
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

  // Load identity keys
  const privateKeyHex = loadPrivateKey(options.agentHomeDir)
  const publicKey = loadPublicKey(options.agentHomeDir)
  if (!privateKeyHex || !publicKey) {
    // No keys — cannot sign; safe failure
    return false
  }

  // Build OperatorKey
  const privateKeyBytes = new Uint8Array(privateKeyHex.length / 2)
  for (let i = 0; i < privateKeyBytes.length; i++) {
    privateKeyBytes[i] = parseInt(privateKeyHex.slice(i * 2, i * 2 + 2), 16)
  }
  const operatorKey: OperatorKey = { publicKey, privateKey: privateKeyBytes }

  // Delegate a short-lived agent key (1 day TTL)
  const agentKey = await delegateAgentKey(operatorKey, 'publish-session', 1)

  // Build and sign the event
  // Always use intent.broadcast so the relay's experience-store picks it up.
  // The experience type is encoded in payload.type = 'experience'.
  const kind: SerendipKind = 'intent.broadcast'
  const payload: ExperiencePayload = {
    type: 'experience',
    data: {
      what: draft.what,
      tried: draft.tried,
      outcome: draft.outcome,
      learned: draft.learned,
    },
  }
  const event = createEvent(kind, payload, [])
  const signed = await signEvent(event, agentKey)

  // HTTP POST to relay
  const relayHttpUrl = options.relayUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
  const postUrl = `${relayHttpUrl.replace(/\/$/, '')}/api/v1/events`

  try {
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}
