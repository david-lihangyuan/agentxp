// trace-publisher.ts — L2 轨迹发布模块
// 将 agent 轨迹发布到 relay 节点

import type { TraceExport } from './trace-recorder.js'

// ─── 类型定义 ───────────────────────────────────────────────────────────────

export interface TracePublishOptions {
  relayUrl: string
  experience: {
    what: string
    tried: string
    outcome: string
    learned: string
  }
  trace: TraceExport
  domain: {
    ecosystem: string
    layer: string
    languages: string[]
    frameworks: string[]
  }
  prerequisites: {
    tools_required: string[]
    access_level: string
    environment: string[]
  }
  version_context?: {
    software: string
    version_range: string
  }
  reproducibility: 'deterministic' | 'env_dependent' | 'state_dependent'
  parent_trace_id?: string
  question_id?: string
  expires_hint?: string
}

export interface TracePublishResult {
  ok: boolean
  id?: string
  error?: string
}

// ─── publishWithTrace ────────────────────────────────────────────────────────

/**
 * 发布带轨迹的经验到 relay
 *
 * 1. 检查 trace_worthiness — low 的只发结论不发轨迹
 * 2. 组装完整 payload
 * 3. POST 到 relay
 */
export async function publishWithTrace(
  opts: TracePublishOptions
): Promise<TracePublishResult> {
  const { relayUrl, experience, trace, domain, prerequisites, reproducibility } = opts

  // 1. 根据 worthiness 决定是否附带完整轨迹
  const includeFullTrace = trace.trace_worthiness === 'high'

  // 2. 组装 payload
  const payload: Record<string, unknown> = {
    experience,
    domain,
    prerequisites,
    reproducibility,
    trace_summary: trace.trace_summary,
    trace_worthiness: trace.trace_worthiness,
    computed_difficulty: trace.computed_difficulty,
    confidence: trace.confidence,
    duration_seconds: trace.duration_seconds,
  }

  if (includeFullTrace) {
    payload.trace = {
      steps: trace.steps,
      dead_ends: trace.dead_ends,
    }
  }

  if (opts.version_context) {
    payload.version_context = opts.version_context
  }
  if (opts.parent_trace_id) {
    payload.parent_trace_id = opts.parent_trace_id
  }
  if (opts.question_id) {
    payload.question_id = opts.question_id
  }
  if (opts.expires_hint) {
    payload.expires_hint = opts.expires_hint
  }

  // 3. POST 到 relay
  try {
    const response = await fetch(`${relayUrl}/experiences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      return { ok: false, error: `HTTP ${response.status}: ${text}` }
    }

    const result = await response.json().catch(() => ({})) as Record<string, unknown>
    return { ok: true, id: result.id as string | undefined }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
