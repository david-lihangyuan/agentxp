// Hook handlers. The three handlers below are pure orchestration —
// message_sending is rule-based only (no LLM invocation), tool_call
// stages one trace step, session_end builds and stages an experience
// for publication.
import type {
  MessageSendingCtx,
  PluginReasoningTrace,
  SessionEndCtx,
  ToolCallCtx,
} from './types.js'
import type { PluginDb, StagedTraceStep } from './db.js'

// Lightweight Tier-1 rule-based flags. The concrete set is
// intentionally small in MVP; the contract is that `message_sending`
// returns synchronously with zero token usage.
export interface MessageSendingSignal {
  session_id: string
  flag: 'ok' | 'suspect_retry' | 'suspect_destructive'
  reason: string
  llm_tokens: 0 // invariant: rule-based extraction only
}

const DESTRUCTIVE = /\b(rm\s+-rf|DROP\s+TABLE|TRUNCATE|force.push|--hard)\b/i

export function onMessageSending(ctx: MessageSendingCtx): MessageSendingSignal {
  const args = JSON.stringify(ctx.tool_call.arguments ?? '')
  if (DESTRUCTIVE.test(args)) {
    return {
      session_id: ctx.session_id,
      flag: 'suspect_destructive',
      reason: 'destructive keyword in tool-call arguments',
      llm_tokens: 0,
    }
  }
  return { session_id: ctx.session_id, flag: 'ok', reason: 'no rule matched', llm_tokens: 0 }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function onToolCall(db: PluginDb, ctx: ToolCallCtx): StagedTraceStep {
  const existing = db.listTraceSteps(ctx.session_id)
  const stepIndex = existing.length
  const resultPreview = truncate(
    typeof ctx.tool_call.result === 'string'
      ? ctx.tool_call.result
      : JSON.stringify(ctx.tool_call.result ?? ''),
    160,
  )
  return db.appendTraceStep({
    session_id: ctx.session_id,
    step_index: stepIndex,
    action: `${ctx.tool_call.name}(${truncate(JSON.stringify(ctx.tool_call.arguments ?? {}), 120)})`,
    outcome_short: resultPreview,
    duration_ms: ctx.tool_call.duration_ms,
    created_at: Math.floor(Date.parse(ctx.created_at) / 1000) || Math.floor(Date.now() / 1000),
  })
}

export function bucketize(totalMs: number): PluginReasoningTrace['duration_bucket'] {
  if (totalMs < 60_000) return 'under_1min'
  if (totalMs < 5 * 60_000) return '1_to_5min'
  if (totalMs < 15 * 60_000) return '5_to_15min'
  return 'over_15min'
}

export function buildTrace(
  steps: StagedTraceStep[],
  contextAtStart: string,
): PluginReasoningTrace {
  const totalMs = steps.reduce((a, s) => a + s.duration_ms, 0)
  const tools = Array.from(new Set(steps.map((s) => s.action.split('(')[0] ?? 'unknown')))
  return {
    steps: steps.map((s) => ({
      step_index: s.step_index,
      action: s.action,
      outcome_short: s.outcome_short,
      duration_ms: s.duration_ms,
    })),
    dead_ends: [],
    trace_summary: `${steps.length} step(s), ${tools.length} tool(s)`,
    confidence: 0.6,
    duration_bucket: bucketize(totalMs),
    tools_used_category: tools,
    context_at_start: contextAtStart,
    prerequisites: { assumed_knowledge: [], environment: [] },
    difficulty: {
      level: steps.length >= 5 ? 'moderate' : 'routine',
      justification: `derived from ${steps.length} trace step(s)`,
    },
    domain_fingerprint: { ecosystem: 'unknown', layer: 'unknown' },
    trace_worthiness: steps.length >= 2 ? 'high' : 'low',
    reproducibility: 'env_dependent',
  }
}

export interface SessionSummaryInput {
  what: string
  tried: string
  outcome: 'succeeded' | 'failed' | 'partial' | 'inconclusive'
  learned: string
  tags?: string[]
  context_at_start?: string
}

export function onSessionEnd(
  db: PluginDb,
  ctx: SessionEndCtx,
  summary: SessionSummaryInput,
): { staged: boolean; reason: string } {
  const steps = db.listTraceSteps(ctx.session_id)
  if (steps.length === 0 && ctx.reason !== 'explicit') {
    // Edge acceptance: zero-activity session with no explicit
    // agentxp reflect MUST NOT publish anything.
    return { staged: false, reason: 'no_activity' }
  }
  const trace = buildTrace(steps, summary.context_at_start ?? ctx.reason)
  const data = {
    what: summary.what,
    tried: summary.tried,
    outcome: summary.outcome,
    learned: summary.learned,
  }
  const now = Math.floor(Date.parse(ctx.ended_at) / 1000) || Math.floor(Date.now() / 1000)
  db.stageExperience({
    session_id: ctx.session_id,
    reason: ctx.reason,
    data_json: JSON.stringify(data),
    trace_json: JSON.stringify(trace),
    tags_json: JSON.stringify(summary.tags ?? []),
    created_at: now,
    next_attempt_at: now,
  })
  return { staged: true, reason: 'session_ended' }
}
