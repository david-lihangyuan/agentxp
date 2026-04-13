// Feedback Client — Fetch, submit, and summarize feedback for published experiences
// Connects to the relay's feedback API to enable cross-agent learning loops.

export interface FeedbackEvent {
  id: number
  target_experience_id: string
  source_pubkey: string
  type: 'cited' | 'verified' | 'contradicted' | 'refined'
  comment?: string
  created_at: number
}

export interface FeedbackSubmission {
  target_experience_id: string
  source_experience_id?: string
  parent_feedback_id?: number
  type: 'cited' | 'verified' | 'contradicted' | 'refined'
  comment?: string
  pubkey: string
  operator_pubkey?: string
  sig: string
}

export interface FeedbackSummary {
  verified: number
  contradicted: number
  refined: number
  cited: number
  status: 'active' | 'strengthened' | 'disputed' | 'weakened' | 'superseded'
}

/**
 * Normalize a relay URL from WebSocket to HTTP(S).
 */
function normalizeUrl(relayUrl: string): string {
  return relayUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '')
}

/**
 * Fetch feedback events for experiences owned by the given pubkey.
 * Optionally filter by a since timestamp (Unix epoch seconds).
 *
 * @param relayUrl - Relay base URL (HTTP/HTTPS or WS/WSS)
 * @param pubkey - Operator public key to fetch feedback for
 * @param since - Optional Unix timestamp to filter feedback created after this time
 */
export async function fetchFeedback(
  relayUrl: string,
  pubkey: string,
  since?: number
): Promise<FeedbackEvent[]> {
  const baseUrl = normalizeUrl(relayUrl)
  const params = new URLSearchParams({ pubkey })
  if (since !== undefined) {
    params.set('since', String(since))
  }

  const res = await fetch(`${baseUrl}/api/v1/feedback?${params}`, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch feedback: HTTP ${res.status}`)
  }

  const data = await res.json() as { feedback: FeedbackEvent[] }
  return data.feedback ?? []
}

/**
 * Submit feedback for an experience (e.g. after using someone else's experience).
 * Validates required fields before sending.
 *
 * @param relayUrl - Relay base URL
 * @param feedback - Feedback submission payload (must be signed)
 */
export async function submitFeedback(
  relayUrl: string,
  feedback: FeedbackSubmission
): Promise<void> {
  // Client-side validation: contradicted and refined require a comment
  if (
    (feedback.type === 'contradicted' || feedback.type === 'refined') &&
    (!feedback.comment || feedback.comment.trim() === '')
  ) {
    throw new Error(`Feedback type '${feedback.type}' requires a comment`)
  }

  const baseUrl = normalizeUrl(relayUrl)

  const res = await fetch(`${baseUrl}/api/v1/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feedback),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`Failed to submit feedback: HTTP ${res.status}`)
  }
}

/**
 * Get a summary of feedback for a specific experience.
 *
 * @param relayUrl - Relay base URL
 * @param experienceId - The experience ID to get feedback summary for
 */
export async function getFeedbackSummary(
  relayUrl: string,
  experienceId: string
): Promise<FeedbackSummary> {
  const baseUrl = normalizeUrl(relayUrl)

  const res = await fetch(`${baseUrl}/api/v1/feedback/summary/${experienceId}`, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`Failed to get feedback summary: HTTP ${res.status}`)
  }

  return await res.json() as FeedbackSummary
}
