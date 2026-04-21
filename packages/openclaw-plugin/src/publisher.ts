// Publish staged experiences (with reasoning_trace) to a relay.
// SPEC 03-modules-product §5 mandates: trace populated on every
// published experience, retry-later on failure, no local delete
// before 200. Retry schedule follows SDK contract (01-interfaces §6).
import { createEvent, signEvent } from '@agentxp/protocol'
import type { AgentKey, ExperiencePayload } from '@agentxp/protocol'
import { MAX_ATTEMPTS, sdkNextAttemptDelay } from './backoff.js'
import type { PluginDb, StagedExperience } from './db.js'

export interface PublishResult {
  stagedId: number
  status: 'published' | 'retry' | 'rejected' | 'abandoned'
  httpStatus: number | null
  eventId?: string
  error?: string
}

export interface PublishOptions {
  relayUrl: string
  agent: AgentKey
  db: PluginDb
  fetch?: typeof globalThis.fetch
  now?: () => number
  random?: () => number
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

async function buildSigned(
  row: StagedExperience,
  agent: AgentKey,
): Promise<Awaited<ReturnType<typeof signEvent>>> {
  const payload: ExperiencePayload = {
    type: 'experience',
    data: JSON.parse(row.data_json),
    reasoning_trace: JSON.parse(row.trace_json),
  }
  const tags = JSON.parse(row.tags_json) as string[]
  const unsigned = createEvent('intent.broadcast', payload, tags, row.created_at)
  return signEvent(unsigned, agent)
}

export async function publishStagedExperiences(opts: PublishOptions): Promise<PublishResult[]> {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const backoffOpts = opts.random ? { random: opts.random } : {}
  const results: PublishResult[] = []

  for (const row of opts.db.listDueExperiences(now())) {
    if (row.retry_count >= MAX_ATTEMPTS) {
      // SPEC 01-interfaces §6: ≤5 attempts. After cap, stop retrying
      // but do NOT delete locally (SPEC §5 bars deletion before 200).
      results.push({ stagedId: row.id, status: 'abandoned', httpStatus: null })
      continue
    }

    const signed = await buildSigned(row, opts.agent)
    let res: Response
    try {
      res = await fetchImpl(`${opts.relayUrl.replace(/\/$/, '')}/api/v1/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: signed }),
      })
    } catch (err) {
      const delay = sdkNextAttemptDelay(row.retry_count + 1, backoffOpts)
      opts.db.markAttempt(row.id, now(), now() + delay)
      results.push({
        stagedId: row.id,
        status: 'retry',
        httpStatus: null,
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    if (res.status === 200) {
      opts.db.removeExperience(row.id)
      opts.db.clearTraceSteps(row.session_id)
      results.push({
        stagedId: row.id,
        status: 'published',
        httpStatus: 200,
        eventId: signed.id,
      })
      continue
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (isRetryable(res.status)) {
      const delay = sdkNextAttemptDelay(row.retry_count + 1, backoffOpts)
      opts.db.markAttempt(row.id, now(), now() + delay)
      results.push({
        stagedId: row.id,
        status: 'retry',
        httpStatus: res.status,
        ...(body.error ? { error: body.error } : {}),
      })
    } else {
      // Non-retryable 4xx: drop local row (relay rejected permanently).
      opts.db.removeExperience(row.id)
      opts.db.clearTraceSteps(row.session_id)
      results.push({
        stagedId: row.id,
        status: 'rejected',
        httpStatus: res.status,
        ...(body.error ? { error: body.error } : {}),
      })
    }
  }

  return results
}
