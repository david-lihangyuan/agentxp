// Publish staged drafts to a relay (SPEC 01-interfaces §5.1, §6).
// Draft rows are removed only on 200 OK or a non-retryable 4xx
// (the SPEC bars deleting rows otherwise).
import { createEvent, signEvent } from '@agentxp/protocol'
import type { AgentKey, ExperiencePayload, SerendipEvent } from '@agentxp/protocol'
import { nextAttemptDelay } from './backoff.js'
import type { DraftRow, DraftStore } from './drafts.js'

export interface PublishResult {
  draftId: number
  status: 'published' | 'retry' | 'rejected'
  httpStatus: number | null
  eventId?: string
  error?: string
}

export interface PublishOptions {
  relayUrl: string
  agent: AgentKey
  store: DraftStore
  fetch?: typeof globalThis.fetch
  now?: () => number
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

function draftToEvent(draft: DraftRow, agent: AgentKey): Promise<SerendipEvent> {
  const payload: ExperiencePayload = {
    type: 'experience',
    data: draft.data,
  }
  const event = createEvent('intent.broadcast', payload, draft.tags, draft.created_at)
  return signEvent(event, agent)
}

export async function publishDrafts(opts: PublishOptions): Promise<PublishResult[]> {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const results: PublishResult[] = []

  for (const draft of opts.store.listDue(now())) {
    const signed = await draftToEvent(draft, opts.agent)
    let res: Response
    try {
      res = await fetchImpl(`${opts.relayUrl.replace(/\/$/, '')}/api/v1/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: signed }),
      })
    } catch (err) {
      const delay = nextAttemptDelay(draft.retry_count + 1)
      opts.store.markAttempt(draft.id, now(), now() + delay)
      results.push({
        draftId: draft.id,
        status: 'retry',
        httpStatus: null,
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    if (res.status === 200) {
      opts.store.remove(draft.id)
      results.push({
        draftId: draft.id,
        status: 'published',
        httpStatus: 200,
        eventId: signed.id,
      })
      continue
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (isRetryable(res.status)) {
      const delay = nextAttemptDelay(draft.retry_count + 1)
      opts.store.markAttempt(draft.id, now(), now() + delay)
      results.push({
        draftId: draft.id,
        status: 'retry',
        httpStatus: res.status,
        ...(body.error ? { error: body.error } : {}),
      })
    } else {
      opts.store.remove(draft.id)
      results.push({
        draftId: draft.id,
        status: 'rejected',
        httpStatus: res.status,
        ...(body.error ? { error: body.error } : {}),
      })
    }
  }

  return results
}
