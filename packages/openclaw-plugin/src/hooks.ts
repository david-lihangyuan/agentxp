// Hook handlers. The three handlers below are pure orchestration —
// message_sending is rule-based only (no LLM invocation), tool_call
// stages one trace step, session_end builds and stages an experience
// for publication.
import type {
  AgentEndCtx,
  BeforeToolCallCtx,
  MessageSendingCtx,
  PluginReasoningTrace,
  SessionEndCtx,
  SessionStartCtx,
  ToolCallCtx,
} from './types.js'
import type { PluginDb, StagedTraceStep } from './db.js'
import { pushKeywords, pushToolName, setLastActiveSession } from './session-state.js'

// Lightweight Tier-1 rule-based flags. The concrete set is
// intentionally small in MVP; the contract is that `message_sending`
// returns synchronously with zero token usage.
export interface MessageSendingSignal {
  session_id: string
  flag: 'ok' | 'suspect_retry' | 'suspect_destructive'
  reason: string
  llm_tokens: 0 // invariant: rule-based extraction only
}

// Each alternative self-anchors: flag tokens that begin with `-` do
// not use a leading \b (word-boundary requires an adjacent word char
// which `-` is not, so `\b--hard\b` never matched the legacy regex).
const DESTRUCTIVE =
  /(?:\brm\s+-rf\b|\bDROP\s+TABLE\b|\bTRUNCATE\b|\bforce\.push\b|--hard\b|--force\b)/i

// Collects candidate keyword tokens from arbitrary tool-call
// arguments. Walks strings recursively, splits path-like segments,
// and keeps alphabetic tokens of length >= 3. Purely syntactic;
// semantic weighting is left to the prompt builder / phase heuristic.
const KEYWORD_SPLIT = /[^a-zA-Z0-9_]+/
const KEYWORD_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'this',
  'that',
  'not',
  'src',
  'dist',
  'lib',
  'node_modules',
  'tmp',
  'var',
  'etc',
  'usr',
  'ts',
  'js',
  'tsx',
  'jsx',
  'json',
  'md',
])

function collectKeywords(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || out.length >= 32) return
  if (typeof value === 'string') {
    for (const raw of value.split(KEYWORD_SPLIT)) {
      const tok = raw.toLowerCase()
      if (tok.length < 3) continue
      if (KEYWORD_STOPWORDS.has(tok)) continue
      if (!out.includes(tok)) out.push(tok)
      if (out.length >= 32) return
    }
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectKeywords(v, out, depth + 1)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectKeywords(v, out, depth + 1)
    }
  }
}

export function onMessageSending(ctx: MessageSendingCtx): MessageSendingSignal {
  // Feed the shared session-state so memory-prompt can read session
  // activity on its next synchronous build.
  setLastActiveSession(ctx.session_id)
  pushToolName(ctx.session_id, ctx.tool_call.name)
  const kws: string[] = []
  collectKeywords(ctx.tool_call.arguments, kws)
  if (kws.length > 0) pushKeywords(ctx.session_id, kws)

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

// M7 Batch 1 — OpenClaw-aligned lifecycle additions. Each handler
// remains host-agnostic: the adapter maps the concrete OpenClaw event
// shape onto these pure signatures.

export interface SessionStartSignal {
  session_id: string
  resumed: boolean
  cleared_steps: number
}

export function onSessionStart(db: PluginDb, ctx: SessionStartCtx): SessionStartSignal {
  if (ctx.session_id.length === 0) {
    throw new Error('onSessionStart: session_id must be non-empty')
  }
  if (ctx.resumed_from !== undefined) {
    return { session_id: ctx.session_id, resumed: true, cleared_steps: 0 }
  }
  const existing = db.listTraceSteps(ctx.session_id).length
  if (existing > 0) db.clearTraceSteps(ctx.session_id)
  return { session_id: ctx.session_id, resumed: false, cleared_steps: existing }
}

export interface BeforeToolCallSignal {
  session_id: string
  blocked: boolean
  block_reason?: string
  llm_tokens: 0
}

export function onBeforeToolCall(ctx: BeforeToolCallCtx): BeforeToolCallSignal {
  if (ctx.tool_name.length === 0) {
    throw new Error('onBeforeToolCall: tool_name must be non-empty')
  }
  const args = JSON.stringify(ctx.arguments ?? '')
  if (DESTRUCTIVE.test(args)) {
    return {
      session_id: ctx.session_id,
      blocked: true,
      block_reason: 'destructive keyword in tool-call arguments',
      llm_tokens: 0,
    }
  }
  return { session_id: ctx.session_id, blocked: false, llm_tokens: 0 }
}

export interface AgentEndSignal {
  dropped_steps: number
  staged_experiences_before: number
}

export function onAgentEnd(db: PluginDb, ctx: AgentEndCtx): AgentEndSignal {
  if (ctx.session_id.length === 0) {
    throw new Error('onAgentEnd: session_id must be non-empty')
  }
  const orphanSteps = db.listTraceSteps(ctx.session_id)
  const stagedBefore = db.listAllExperiences().length
  if (orphanSteps.length > 0) db.clearTraceSteps(ctx.session_id)
  return {
    dropped_steps: orphanSteps.length,
    staged_experiences_before: stagedBefore,
  }
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
    action: `${ctx.tool_call.name}(${truncate(
      JSON.stringify(ctx.tool_call.arguments ?? {}),
      120,
    )})`,
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

export function buildTrace(steps: StagedTraceStep[], contextAtStart: string): PluginReasoningTrace {
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
  // Trace steps are captured into the staged experience's trace_json;
  // leaving them in place would re-appear in a later session with the
  // same session_id and, more importantly, confuse agent_end's orphan
  // sweep.
  if (steps.length > 0) db.clearTraceSteps(ctx.session_id)
  return { staged: true, reason: 'session_ended' }
}
