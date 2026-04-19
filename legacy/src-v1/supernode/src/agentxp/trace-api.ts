// Supernode AgentXP — L2 Trace API
// Search enhancement params, transferability scoring, conflict detection,
// feedback interface, deprecation, and pubkey rate limiting.

import type Database from 'better-sqlite3'

// ====== Search Enhancement Params ======

export interface TraceSearchParams {
  /** Return full reasoning_trace JSON (default: false) (#16) */
  include_trace?: boolean
  /** Return context_at_start from trace JSON (default: false) (#9) */
  include_context?: boolean
  /** Minimum trace worthiness filter (#22) */
  min_worthiness?: 'low' | 'high'
  /** Consumer's available tool categories (#14) */
  consumer_tools?: string[]
  /** Consumer's environment tags (#14) */
  consumer_env?: string[]
  /** Consumer's software version (#15) */
  version?: string
  /** Exclude deprecated experiences (default: true) (#28) */
  exclude_deprecated?: boolean
}

// ====== Transferability Score (#23) ======

/**
 * Compute a transferability score (0.0–1.0) based on how well the consumer's
 * tools/env match the trace's prerequisites and domain fingerprint.
 *
 * Scoring:
 *   - Tools match: (matching tools / total required tools) * 0.5
 *   - Env match: (matching env / total required env) * 0.3
 *   - Domain match (languages + frameworks): normalized overlap * 0.2
 * If no requirements/domain exist, that component scores full marks.
 */
export function computeTransferabilityScore(
  consumerTools: string[],
  consumerEnv: string[],
  tracePrereqs: { tools_required: string[]; environment: string[] },
  traceDomain: { languages: string[]; frameworks: string[] }
): number {
  const normalize = (s: string) => s.toLowerCase().trim()

  const cTools = consumerTools.map(normalize)
  const cEnv = consumerEnv.map(normalize)
  const reqTools = tracePrereqs.tools_required.map(normalize)
  const reqEnv = tracePrereqs.environment.map(normalize)
  const domLang = traceDomain.languages.map(normalize)
  const domFw = traceDomain.frameworks.map(normalize)

  // Tools component (weight 0.5)
  let toolScore: number
  if (reqTools.length === 0) {
    toolScore = 1.0
  } else {
    const matched = reqTools.filter((t) => cTools.includes(t)).length
    toolScore = matched / reqTools.length
  }

  // Environment component (weight 0.3)
  let envScore: number
  if (reqEnv.length === 0) {
    envScore = 1.0
  } else {
    const matched = reqEnv.filter((e) => cEnv.includes(e)).length
    envScore = matched / reqEnv.length
  }

  // Domain fingerprint component (weight 0.2)
  const domainItems = [...domLang, ...domFw]
  const consumerItems = [...cTools, ...cEnv] // consumer can match domain via either
  let domainScore: number
  if (domainItems.length === 0) {
    domainScore = 1.0
  } else {
    const matched = domainItems.filter((d) => consumerItems.includes(d)).length
    domainScore = matched / domainItems.length
  }

  const score = toolScore * 0.5 + envScore * 0.3 + domainScore * 0.2
  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, score))
}

// ====== Conflict Detection (#24) ======

/**
 * Detect if there are 2+ experiences under the same question_id with different
 * conclusions (different `outcome` or different `learned` content).
 */
export function detectConflictingTraces(questionId: string, experiences: Array<{
  question_id?: string | null
  outcome?: string
  learned?: string
}>): boolean {
  if (!questionId) return false

  const relevant = experiences.filter(
    (e) => e.question_id === questionId
  )

  if (relevant.length < 2) return false

  // Check for distinct outcomes
  const outcomes = new Set(relevant.map((e) => (e.outcome ?? '').toLowerCase().trim()))
  if (outcomes.size > 1) return true

  // Check for distinct learned content (simple inequality check)
  const learnedSet = new Set(relevant.map((e) => (e.learned ?? '').toLowerCase().trim()))
  if (learnedSet.size > 1) return true

  return false
}

// ====== Feedback Interface (#17) ======

export interface FeedbackInput {
  trace_id: string
  consumer_pubkey: string
  applied: boolean
  outcome: 'success' | 'partial' | 'failed'
  notes?: string
  transferability_perceived?: number
}

export interface FeedbackResult {
  ok: boolean
  id?: number
  error?: string
}

export interface FeedbackStats {
  total: number
  success: number
  partial: number
  failed: number
  avg_transferability: number | null
}

/**
 * Submit feedback for a trace. Returns error if duplicate (UNIQUE constraint:
 * one feedback per trace_id + consumer_pubkey).
 */
export async function submitFeedback(
  db: Database.Database,
  input: FeedbackInput
): Promise<FeedbackResult> {
  const now = Math.floor(Date.now() / 1000)
  try {
    const result = db
      .prepare(
        `INSERT INTO trace_feedback
           (trace_id, consumer_pubkey, applied, outcome, notes, transferability_perceived, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.trace_id,
        input.consumer_pubkey,
        input.applied ? 1 : 0,
        input.outcome,
        input.notes ?? null,
        input.transferability_perceived ?? null,
        now
      )
    return { ok: true, id: result.lastInsertRowid as number }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE constraint failed')) {
      return { ok: false, error: 'duplicate feedback: already submitted for this trace and consumer' }
    }
    return { ok: false, error: msg }
  }
}

/**
 * Get aggregated feedback stats for a given trace_id.
 */
export async function getFeedbackStats(
  db: Database.Database,
  traceId: string
): Promise<FeedbackStats> {
  const rows = db
    .prepare(
      `SELECT outcome, transferability_perceived FROM trace_feedback WHERE trace_id = ?`
    )
    .all(traceId) as Array<{ outcome: string; transferability_perceived: number | null }>

  const total = rows.length
  let success = 0
  let partial = 0
  let failed = 0
  let transferabilitySum = 0
  let transferabilityCount = 0

  for (const row of rows) {
    if (row.outcome === 'success') success++
    else if (row.outcome === 'partial') partial++
    else if (row.outcome === 'failed') failed++

    if (row.transferability_perceived !== null) {
      transferabilitySum += row.transferability_perceived
      transferabilityCount++
    }
  }

  const avg_transferability = transferabilityCount > 0
    ? transferabilitySum / transferabilityCount
    : null

  return { total, success, partial, failed, avg_transferability }
}

// ====== Deprecation (#28) ======

export interface DeprecateResult {
  ok: boolean
  error?: string
  stale_references_updated?: number
}

/**
 * Deprecate an experience by setting deprecated_at + deprecated_by.
 * Also marks all trace_references pointing to this experience as stale=1.
 */
export async function deprecateExperience(
  db: Database.Database,
  experienceId: number,
  deprecatedBy: string
): Promise<DeprecateResult> {
  const now = Math.floor(Date.now() / 1000)

  // Check the experience exists
  const exp = db
    .prepare('SELECT id, deprecated_at FROM experiences WHERE id = ?')
    .get(experienceId) as { id: number; deprecated_at: number | null } | undefined

  if (!exp) {
    return { ok: false, error: `experience ${experienceId} not found` }
  }

  try {
    const updateExp = db.prepare(
      `UPDATE experiences SET deprecated_at = ?, deprecated_by = ? WHERE id = ? AND deprecated_at IS NULL`
    )

    // Mark stale references
    const updateRefs = db.prepare(
      `UPDATE trace_references SET stale = 1 WHERE referenced_experience_id = ? AND stale = 0`
    )

    let staleCount = 0
    db.transaction(() => {
      updateExp.run(now, deprecatedBy, experienceId)
      const refResult = updateRefs.run(experienceId)
      staleCount = refResult.changes
    })()

    return { ok: true, stale_references_updated: staleCount }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// ====== Pubkey Rate Limiting (#5) ======

/** Maximum number of results from the same pubkey in a single search response */
export const PUBKEY_RESULT_LIMIT = 5

/**
 * Apply pubkey rate limiting to a list of search result experiences.
 * Ensures no single pubkey contributes more than PUBKEY_RESULT_LIMIT results.
 */
export function applyPubkeyLimit<T extends { pubkey?: string }>(
  results: T[],
  limit: number = PUBKEY_RESULT_LIMIT
): T[] {
  const counts = new Map<string, number>()
  const output: T[] = []

  for (const item of results) {
    const pk = item.pubkey ?? '__unknown__'
    const current = counts.get(pk) ?? 0
    if (current < limit) {
      output.push(item)
      counts.set(pk, current + 1)
    }
  }

  return output
}

// ====== Search Result Enrichment ======

export interface TraceEnrichedExperience {
  /** trace_summary always returned if available in reasoning_trace */
  trace_summary?: string | null
  /** full reasoning_trace only if include_trace=true */
  reasoning_trace?: unknown
  /** context_at_start from trace only if include_context=true */
  context_at_start?: unknown
  /** Transferability score 0.0-1.0 based on consumer env vs domain */
  transferability_score?: number
  /** Whether there are conflicting traces for the same question_id */
  conflicting_traces?: boolean
}

interface ExperienceRow {
  reasoning_trace?: string | null
  question_id?: string | null
  [key: string]: unknown
}

/**
 * Enrich a single experience with trace metadata based on TraceSearchParams.
 */
export function enrichWithTrace(
  experience: ExperienceRow,
  params: TraceSearchParams,
  allExperiences: ExperienceRow[]
): TraceEnrichedExperience {
  const result: TraceEnrichedExperience = {}

  // Parse reasoning_trace JSON once
  let parsedTrace: Record<string, unknown> | null = null
  if (experience.reasoning_trace) {
    try {
      parsedTrace = JSON.parse(experience.reasoning_trace as string) as Record<string, unknown>
    } catch {
      parsedTrace = null
    }
  }

  // Always include trace_summary if available
  result.trace_summary = parsedTrace
    ? (parsedTrace['summary'] as string | null | undefined) ?? null
    : null

  // Include full trace if requested
  if (params.include_trace) {
    result.reasoning_trace = parsedTrace
  }

  // Include context_at_start if requested
  if (params.include_context) {
    result.context_at_start = parsedTrace
      ? (parsedTrace['context_at_start'] ?? null)
      : null
  }

  // Compute transferability score if consumer context is provided
  if (params.consumer_tools || params.consumer_env) {
    const tracePrereqs: { tools_required: string[]; environment: string[] } = {
      tools_required: [],
      environment: [],
    }
    const traceDomain: { languages: string[]; frameworks: string[] } = {
      languages: [],
      frameworks: [],
    }

    if (parsedTrace) {
      const prereqs = parsedTrace['prerequisites'] as Record<string, string[]> | null | undefined
      if (prereqs) {
        tracePrereqs.tools_required = prereqs['tools_required'] ?? []
        tracePrereqs.environment = prereqs['environment'] ?? []
      }
      const domain = parsedTrace['domain_fingerprint'] as Record<string, string[]> | null | undefined
      if (domain) {
        traceDomain.languages = domain['languages'] ?? []
        traceDomain.frameworks = domain['frameworks'] ?? []
      }
    }

    result.transferability_score = computeTransferabilityScore(
      params.consumer_tools ?? [],
      params.consumer_env ?? [],
      tracePrereqs,
      traceDomain
    )
  }

  // Detect conflicting traces for the same question_id
  const questionId = experience.question_id
  if (questionId) {
    result.conflicting_traces = detectConflictingTraces(
      questionId,
      allExperiences as Array<{ question_id?: string | null; outcome?: string; learned?: string }>
    )
  } else {
    result.conflicting_traces = false
  }

  return result
}

/**
 * Build SQL WHERE clause additions for TraceSearchParams filtering.
 * Returns { conditions: string[], params: (string | number)[] }
 */
export function buildTraceFilterConditions(traceParams: TraceSearchParams): {
  conditions: string[]
  params: (string | number)[]
} {
  const conditions: string[] = []
  const params: (string | number)[] = []

  // Exclude deprecated (default true)
  const excludeDeprecated = traceParams.exclude_deprecated !== false
  if (excludeDeprecated) {
    conditions.push('e.deprecated_at IS NULL')
  }

  // Min worthiness filter
  if (traceParams.min_worthiness === 'high') {
    conditions.push("e.trace_worthiness = 'high'")
  }
  // 'low' = no filter needed (low is lowest threshold, both low and high pass)

  return { conditions, params }
}
