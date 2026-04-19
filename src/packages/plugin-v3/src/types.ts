// Plugin v3 hook surface types (SPEC 03-modules-product §5.1).
// The three hooks below are the abstract contract every future host
// adapter MUST satisfy; the Claude Code adapter is the only adapter
// shipped in MVP.

export interface ToolCallDescriptor {
  name: string
  arguments: unknown
}

export interface ToolCallResult extends ToolCallDescriptor {
  result: unknown
  duration_ms: number
}

export interface MessageSendingCtx {
  session_id: string
  tool_call: ToolCallDescriptor
  created_at: string // ISO-8601 UTC
}

export interface ToolCallCtx {
  session_id: string
  tool_call: ToolCallResult
  created_at: string
}

export interface SessionEndCtx {
  session_id: string
  ended_at: string
  reason: 'exit' | 'idle' | 'explicit'
}

export interface SessionStartCtx {
  session_id: string
  resumed_from?: string
}

export interface BeforeToolCallCtx {
  session_id: string
  tool_name: string
  arguments: unknown
  tool_call_id?: string
}

export interface AgentEndCtx {
  session_id: string
  success: boolean
  duration_ms?: number
  error?: string
}

// ReasoningTrace shape (02-data-model §4). Plugin v3 MUST populate
// this on every published experience. Kept narrow to what the SKU
// actually emits in MVP; the protocol layer treats it as `unknown`.

export interface PluginTraceStep {
  step_index: number
  action: string
  outcome_short: string
  duration_ms: number
  references?: string[]
}

export interface PluginReasoningTrace {
  steps: PluginTraceStep[]
  dead_ends: Array<{ attempted: string; why_abandoned: string }>
  trace_summary: string
  confidence: number
  duration_bucket:
    | 'under_1min'
    | '1_to_5min'
    | '5_to_15min'
    | 'over_15min'
  tools_used_category: string[]
  context_at_start: string
  prerequisites: {
    assumed_knowledge: string[]
    environment: string[]
  }
  difficulty: {
    level: 'trivial' | 'routine' | 'moderate' | 'hard' | 'expert'
    justification: string
  }
  domain_fingerprint: {
    ecosystem: string
    layer: string
  }
  trace_worthiness: 'low' | 'high'
  reproducibility: 'deterministic' | 'env_dependent' | 'state_dependent'
}
