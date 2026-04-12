// Feedback Loop — fetches verification results, updates impact scores, triggers solver retries
//
// Usage: npx tsx scripts/cold-start/feedback.ts --relay=https://relay.agentxp.io

import { createEvent, signEvent } from '../../packages/protocol/src/index.js'
import { publishEvent } from './publish.js'
import type { AgentKey } from '../../packages/protocol/src/types.js'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface FeedbackConfig {
  relayUrl: string
  operatorKey: { publicKey: string; privateKey: Uint8Array }
}

interface FeedbackResult {
  processed: number
  retried: number
}

// ─────────────────────────────────────────────────────────────
// Fetch verification results from relay
// ─────────────────────────────────────────────────────────────

export async function fetchVerificationResults(
  relayUrl: string,
  limit?: number,
): Promise<unknown[]> {
  const limitParam = limit != null ? `&limit=${limit}` : ''

  const [passResponse, failResponse] = await Promise.all([
    fetch(`${relayUrl}/api/cold-start/questions?status=verified_pass${limitParam}`),
    fetch(`${relayUrl}/api/cold-start/questions?status=verified_fail${limitParam}`),
  ])

  if (!passResponse.ok) {
    throw new Error(`Failed to fetch pass results: HTTP ${passResponse.status}`)
  }
  if (!failResponse.ok) {
    throw new Error(`Failed to fetch fail results: HTTP ${failResponse.status}`)
  }

  const passResults = (await passResponse.json()) as unknown[]
  const failResults = (await failResponse.json()) as unknown[]

  return [...passResults, ...failResults]
}

// ─────────────────────────────────────────────────────────────
// Process a passed verification result
// ─────────────────────────────────────────────────────────────

export async function processPassResult(
  result: Record<string, unknown>,
  config: FeedbackConfig,
): Promise<void> {
  const payload = result.payload as { data?: { solution_id?: string } } | undefined
  const solutionId = payload?.data?.solution_id ?? String(result.event_id ?? '')

  // 1. Update solution status to 'verified'
  await fetch(`${config.relayUrl}/api/cold-start/events/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: solutionId,
      status: 'verified',
    }),
  })

  // 2. Boost impact score if experience exists
  const eventId = String(result.event_id ?? '')
  if (eventId) {
    try {
      const verifyResponse = await fetch(
        `${config.relayUrl}/api/experiences/${eventId}/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pubkey: config.operatorKey.publicKey,
          }),
        },
      )
      // 404 is fine — experience may not exist yet
      if (!verifyResponse.ok && verifyResponse.status !== 404) {
        console.error(`Impact verify failed for ${eventId}: HTTP ${verifyResponse.status}`)
      }
    } catch {
      // best-effort impact scoring
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Process a failed verification result
// ─────────────────────────────────────────────────────────────

export async function processFailResult(
  result: Record<string, unknown>,
  config: FeedbackConfig,
): Promise<boolean> {
  const payload = result.payload as {
    data?: { solution_id?: string; question_text?: string; retry_count?: number }
  } | undefined
  const solutionId = payload?.data?.solution_id ?? String(result.event_id ?? '')
  const retryCount = payload?.data?.retry_count ?? 0

  // 1. Update solution status to 'failed'
  await fetch(`${config.relayUrl}/api/cold-start/events/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: solutionId,
      status: 'failed',
    }),
  })

  // 2. Retry only once — skip if already retried
  if (retryCount >= 1) {
    return false
  }

  // 3. Re-publish original question as new intent.question with retry_count incremented
  const agentKey: AgentKey = {
    publicKey: config.operatorKey.publicKey,
    privateKey: config.operatorKey.privateKey,
    delegatedBy: config.operatorKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
  }

  const questionText = payload?.data?.question_text ?? ''
  const retryPayload = {
    type: 'intent.question',
    data: {
      question: questionText,
      retry_count: retryCount + 1,
      original_solution_id: solutionId,
    },
  }

  const unsigned = createEvent('intent.question', retryPayload, [])
  const signed = await signEvent(unsigned, agentKey)
  const pub = await publishEvent(signed, config.relayUrl)

  if (!pub.ok) {
    console.error(`Failed to re-publish question for retry: ${pub.error}`)
    return false
  }

  return true
}

// ─────────────────────────────────────────────────────────────
// Run feedback loop
// ─────────────────────────────────────────────────────────────

export async function runFeedback(
  config: FeedbackConfig,
  limit?: number,
): Promise<FeedbackResult> {
  const stats: FeedbackResult = { processed: 0, retried: 0 }

  const results = await fetchVerificationResults(config.relayUrl, limit)

  for (const raw of results) {
    const result = raw as Record<string, unknown>
    const payload = result.payload as { type?: string } | undefined
    const kind = payload?.type ?? String(result.kind ?? '')

    if (kind === 'verification.pass' || String(result.status ?? '') === 'verified_pass') {
      await processPassResult(result, config)
      stats.processed++
    } else if (kind === 'verification.fail' || String(result.status ?? '') === 'verified_fail') {
      await processFailResult(result, config)
      const retried = await isRetried(result)
      if (retried) {
        stats.retried++
      }
      stats.processed++
    }
  }

  return stats
}

/** Check if a fail result was retried (retry_count < 1). */
function isRetried(result: Record<string, unknown>): boolean {
  const payload = result.payload as { data?: { retry_count?: number } } | undefined
  const retryCount = payload?.data?.retry_count ?? 0
  return retryCount < 1
}

// ─────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const relayArg = args.find((a) => a.startsWith('--relay='))
  if (!relayArg) {
    console.error('Usage: npx tsx scripts/cold-start/feedback.ts --relay=<url>')
    process.exit(1)
  }
  const relayUrl = relayArg.split('=').slice(1).join('=')

  const limitArg = args.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined

  // In production, load keys from ~/.agentxp/identity/
  // For now, generate ephemeral keys
  const { generateOperatorKey } = await import('../../packages/protocol/src/index.js')
  const operatorKey = await generateOperatorKey()

  const config: FeedbackConfig = { relayUrl, operatorKey }

  console.log(`Feedback loop starting — relay: ${relayUrl}`)
  const stats = await runFeedback(config, limit)
  console.log(`Done — processed: ${stats.processed}, retried: ${stats.retried}`)
}

// Only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1]?.endsWith('feedback.ts') || process.argv[1]?.endsWith('feedback.js')
if (isDirectRun) {
  main().catch((err) => {
    console.error('Feedback loop failed:', err)
    process.exit(1)
  })
}
