// trace-analytics.test.ts — Tests for computeDomainInsights & discoverPatterns

import { describe, it, expect } from 'vitest'
import { computeDomainInsights, discoverPatterns } from '../src/agentxp/trace-analytics'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrace(opts: {
  steps?: Array<{ action: string }>
  dead_ends?: Array<{ tried: string }>
} = {}): string {
  return JSON.stringify({
    steps: (opts.steps ?? []).map((s) => ({
      action: s.action,
      content: 'content',
      significance: 'routine',
    })),
    dead_ends: (opts.dead_ends ?? []).map((d, i) => ({
      step_index: i,
      tried: d.tried,
      why_abandoned: 'did not work',
      sensitivity_class: 'public',
    })),
    duration_bucket: 'under_1min',
    trace_summary: 'test',
    confidence: 0.8,
    tools_used_category: [],
    context_at_start: '',
    prerequisites: { tools_required: [], environment: [] },
    difficulty: { estimated: 'medium', actual: 'medium', surprise_factor: 0 },
    domain_fingerprint: { languages: [], frameworks: [] },
    trace_worthiness: 'high',
    reproducibility: 'deterministic',
  })
}

function makeExp(opts: {
  outcome?: string
  domain_ecosystem?: string
  domain_layer?: string
  reasoning_trace?: string | null
} = {}) {
  return {
    outcome: opts.outcome ?? 'succeeded',
    domain_ecosystem: opts.domain_ecosystem ?? 'software',
    domain_layer: opts.domain_layer ?? 'backend',
    reasoning_trace: opts.reasoning_trace !== undefined
      ? opts.reasoning_trace
      : makeTrace({ steps: [{ action: 'investigate' }, { action: 'decide' }] }),
  }
}

// ---------------------------------------------------------------------------
// computeDomainInsights — basic
// ---------------------------------------------------------------------------

describe('computeDomainInsights — basic', () => {
  it('returns empty array for empty input', () => {
    expect(computeDomainInsights([])).toEqual([])
  })

  it('returns one insight for single-domain input', () => {
    const exps = [makeExp(), makeExp(), makeExp()]
    const result = computeDomainInsights(exps)
    expect(result).toHaveLength(1)
    expect(result[0].domain_ecosystem).toBe('software')
    expect(result[0].domain_layer).toBe('backend')
    expect(result[0].total_traces).toBe(3)
  })

  it('returns separate insights for different domains', () => {
    const exps = [
      makeExp({ domain_ecosystem: 'software', domain_layer: 'backend' }),
      makeExp({ domain_ecosystem: 'infra', domain_layer: 'k8s' }),
      makeExp({ domain_ecosystem: 'software', domain_layer: 'frontend' }),
    ]
    const result = computeDomainInsights(exps)
    expect(result).toHaveLength(3)
  })

  it('correctly groups experiences into same domain', () => {
    const exps = [
      makeExp({ domain_ecosystem: 'software', domain_layer: 'backend' }),
      makeExp({ domain_ecosystem: 'software', domain_layer: 'backend' }),
      makeExp({ domain_ecosystem: 'infra', domain_layer: 'k8s' }),
    ]
    const result = computeDomainInsights(exps)
    const swBe = result.find((r) => r.domain_ecosystem === 'software' && r.domain_layer === 'backend')
    const infra = result.find((r) => r.domain_ecosystem === 'infra')
    expect(swBe?.total_traces).toBe(2)
    expect(infra?.total_traces).toBe(1)
  })

  it('computes success_rate correctly', () => {
    const exps = [
      makeExp({ outcome: 'succeeded' }),
      makeExp({ outcome: 'succeeded' }),
      makeExp({ outcome: 'failed' }),
      makeExp({ outcome: 'failed' }),
    ]
    const result = computeDomainInsights(exps)
    expect(result[0].success_rate).toBeCloseTo(0.5)
  })

  it('handles experiences with no reasoning_trace (null)', () => {
    const exps = [
      makeExp({ reasoning_trace: null }),
      makeExp({ reasoning_trace: null }),
    ]
    const result = computeDomainInsights(exps)
    expect(result[0].total_traces).toBe(2)
    expect(result[0].avg_steps).toBe(0)
    expect(result[0].avg_dead_ends).toBe(0)
  })

  it('handles experiences with invalid JSON trace gracefully', () => {
    const exps = [
      makeExp({ reasoning_trace: 'not-json' }),
      makeExp({ reasoning_trace: makeTrace({ steps: [{ action: 'observe' }] }) }),
    ]
    const result = computeDomainInsights(exps)
    // 1 valid trace with 1 step, 1 invalid → avg_steps = 0.5
    expect(result[0].avg_steps).toBeCloseTo(0.5)
  })

  it('computes avg_steps correctly', () => {
    const exps = [
      makeExp({
        reasoning_trace: makeTrace({ steps: [{ action: 'observe' }, { action: 'decide' }] }),
      }),
      makeExp({
        reasoning_trace: makeTrace({
          steps: [{ action: 'observe' }, { action: 'investigate' }, { action: 'decide' }, { action: 'verify' }],
        }),
      }),
    ]
    const result = computeDomainInsights(exps)
    expect(result[0].avg_steps).toBeCloseTo(3) // (2+4)/2
  })

  it('computes avg_dead_ends correctly', () => {
    const exps = [
      makeExp({ reasoning_trace: makeTrace({ dead_ends: [{ tried: 'approach_a' }] }) }),
      makeExp({ reasoning_trace: makeTrace({ dead_ends: [{ tried: 'approach_b' }, { tried: 'approach_c' }] }) }),
      makeExp({ reasoning_trace: makeTrace({}) }),
    ]
    const result = computeDomainInsights(exps)
    expect(result[0].avg_dead_ends).toBeCloseTo(1) // (1+2+0)/3
  })
})

// ---------------------------------------------------------------------------
// computeDomainInsights — most_common_dead_end_actions
// ---------------------------------------------------------------------------

describe('computeDomainInsights — most_common_dead_end_actions', () => {
  it('returns empty array when no dead ends', () => {
    const exps = [makeExp({ reasoning_trace: makeTrace({}) })]
    const result = computeDomainInsights(exps)
    expect(result[0].most_common_dead_end_actions).toEqual([])
  })

  it('counts dead-end tried labels correctly', () => {
    const exps = [
      makeExp({
        reasoning_trace: makeTrace({
          dead_ends: [{ tried: 'restart_service' }, { tried: 'clear_cache' }],
        }),
      }),
      makeExp({
        reasoning_trace: makeTrace({
          dead_ends: [{ tried: 'restart_service' }],
        }),
      }),
    ]
    const result = computeDomainInsights(exps)
    const actions = result[0].most_common_dead_end_actions
    const restartEntry = actions.find((a) => a.action === 'restart_service')
    const cacheEntry = actions.find((a) => a.action === 'clear_cache')
    expect(restartEntry?.count).toBe(2)
    expect(cacheEntry?.count).toBe(1)
  })

  it('returns most common first (sorted descending)', () => {
    const exps = [
      makeExp({
        reasoning_trace: makeTrace({
          dead_ends: [
            { tried: 'approach_a' },
            { tried: 'approach_b' },
            { tried: 'approach_b' },
            { tried: 'approach_b' },
          ],
        }),
      }),
    ]
    const result = computeDomainInsights(exps)
    const actions = result[0].most_common_dead_end_actions
    expect(actions[0].action).toBe('approach_b')
    expect(actions[0].count).toBe(3)
  })

  it('limits to top 5 dead-end actions', () => {
    const deadEnds = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((tried) => ({ tried }))
    const exps = [makeExp({ reasoning_trace: makeTrace({ dead_ends: deadEnds }) })]
    const result = computeDomainInsights(exps)
    expect(result[0].most_common_dead_end_actions.length).toBeLessThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// computeDomainInsights — weakness_indicators
// ---------------------------------------------------------------------------

describe('computeDomainInsights — weakness_indicators', () => {
  it('flags high_dead_end_rate when avg_dead_ends > 1.5', () => {
    const exps = [
      makeExp({ reasoning_trace: makeTrace({ dead_ends: [{ tried: 'a' }, { tried: 'b' }, { tried: 'c' }] }) }),
    ]
    const result = computeDomainInsights(exps)
    expect(result[0].weakness_indicators).toContain('high_dead_end_rate')
  })

  it('flags low_success_rate when success_rate < 0.5', () => {
    const exps = [
      makeExp({ outcome: 'failed', reasoning_trace: makeTrace({}) }),
      makeExp({ outcome: 'failed', reasoning_trace: makeTrace({}) }),
      makeExp({ outcome: 'failed', reasoning_trace: makeTrace({}) }),
    ]
    const result = computeDomainInsights(exps)
    expect(result[0].weakness_indicators).toContain('low_success_rate')
  })

  it('returns empty weakness_indicators for healthy domain', () => {
    const exps = [
      makeExp({ outcome: 'succeeded', reasoning_trace: makeTrace({ steps: [{ action: 'decide' }] }) }),
      makeExp({ outcome: 'succeeded', reasoning_trace: makeTrace({ steps: [{ action: 'decide' }] }) }),
    ]
    const result = computeDomainInsights(exps)
    expect(result[0].weakness_indicators).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// discoverPatterns — basic
// ---------------------------------------------------------------------------

describe('discoverPatterns — basic', () => {
  it('returns empty array for empty input', () => {
    expect(discoverPatterns([])).toEqual([])
  })

  it('returns 4 patterns for non-empty input', () => {
    const exps = [makeExp()]
    const result = discoverPatterns(exps)
    expect(result).toHaveLength(4)
  })

  it('returns pattern names correctly', () => {
    const exps = [makeExp()]
    const names = discoverPatterns(exps).map((p) => p.pattern)
    expect(names).toContain('investigate_before_decide')
    expect(names).toContain('backtrack_leads_to_success')
    expect(names).toContain('dead_end_recovery')
    expect(names).toContain('quick_conclude')
  })

  it('frequency and confidence are in [0, 1]', () => {
    const exps = Array.from({ length: 5 }, () => makeExp())
    const result = discoverPatterns(exps)
    for (const p of result) {
      expect(p.frequency).toBeGreaterThanOrEqual(0)
      expect(p.frequency).toBeLessThanOrEqual(1)
      expect(p.confidence).toBeGreaterThanOrEqual(0)
      expect(p.confidence).toBeLessThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// discoverPatterns — investigate_before_decide
// ---------------------------------------------------------------------------

describe('discoverPatterns — investigate_before_decide', () => {
  it('detects pattern when investigate precedes decide', () => {
    const exps = [
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({
          steps: [{ action: 'investigate' }, { action: 'decide' }],
        }),
      },
    ]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'investigate_before_decide')!
    expect(pat.frequency).toBeCloseTo(1.0)
    expect(pat.confidence).toBeCloseTo(1.0)
  })

  it('does not detect pattern when decide comes before investigate', () => {
    const exps = [
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({
          steps: [{ action: 'decide' }, { action: 'investigate' }],
        }),
      },
    ]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'investigate_before_decide')!
    expect(pat.frequency).toBeCloseTo(0)
  })

  it('does not detect pattern when only investigate but no decide', () => {
    const exps = [
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({ steps: [{ action: 'investigate' }] }),
      },
    ]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'investigate_before_decide')!
    expect(pat.frequency).toBeCloseTo(0)
  })
})

// ---------------------------------------------------------------------------
// discoverPatterns — backtrack_leads_to_success
// ---------------------------------------------------------------------------

describe('discoverPatterns — backtrack_leads_to_success', () => {
  it('detects backtrack pattern with correct confidence', () => {
    const exps = [
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({ steps: [{ action: 'backtrack' }] }),
      },
      {
        outcome: 'failed',
        reasoning_trace: makeTrace({ steps: [{ action: 'backtrack' }] }),
      },
    ]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'backtrack_leads_to_success')!
    expect(pat.frequency).toBeCloseTo(1.0)
    expect(pat.confidence).toBeCloseTo(0.5)
  })

  it('frequency is 0 when no backtrack actions exist', () => {
    const exps = [
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({ steps: [{ action: 'decide' }] }),
      },
    ]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'backtrack_leads_to_success')!
    expect(pat.frequency).toBeCloseTo(0)
    expect(pat.confidence).toBeCloseTo(0)
  })
})

// ---------------------------------------------------------------------------
// discoverPatterns — dead_end_recovery
// ---------------------------------------------------------------------------

describe('discoverPatterns — dead_end_recovery', () => {
  it('computes recovery rate from dead-end experiences', () => {
    const exps = [
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({ dead_ends: [{ tried: 'a' }] }),
      },
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({ dead_ends: [{ tried: 'b' }] }),
      },
      {
        outcome: 'failed',
        reasoning_trace: makeTrace({ dead_ends: [{ tried: 'c' }] }),
      },
    ]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'dead_end_recovery')!
    expect(pat.frequency).toBeCloseTo(1.0) // all 3 have dead ends
    expect(pat.confidence).toBeCloseTo(2 / 3)
  })

  it('frequency is 0 when no experiences have dead ends', () => {
    const exps = [{ outcome: 'succeeded', reasoning_trace: makeTrace({}) }]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'dead_end_recovery')!
    expect(pat.frequency).toBeCloseTo(0)
  })
})

// ---------------------------------------------------------------------------
// discoverPatterns — quick_conclude
// ---------------------------------------------------------------------------

describe('discoverPatterns — quick_conclude', () => {
  it('detects quick_conclude for traces with 0, 1, or 2 steps', () => {
    const exps = [
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({ steps: [{ action: 'decide' }] }),
      },
      {
        outcome: 'failed',
        reasoning_trace: makeTrace({
          steps: [{ action: 'decide' }, { action: 'conclude' }, { action: 'verify' }],
        }),
      },
    ]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'quick_conclude')!
    // only first has < 3 steps
    expect(pat.frequency).toBeCloseTo(0.5)
    expect(pat.confidence).toBeCloseTo(1.0)
  })

  it('experiences with null trace do not contribute to quick_conclude', () => {
    const exps = [
      { outcome: 'succeeded', reasoning_trace: null },
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({
          steps: [{ action: 'decide' }, { action: 'conclude' }, { action: 'verify' }],
        }),
      },
    ]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'quick_conclude')!
    // null trace → not counted; second has 3 steps (not < 3)
    expect(pat.frequency).toBeCloseTo(0)
  })
})

// ---------------------------------------------------------------------------
// discoverPatterns — edge cases
// ---------------------------------------------------------------------------

describe('discoverPatterns — edge cases', () => {
  it('handles all-success input: confidence is 1.0 where pattern applies', () => {
    const exps = Array.from({ length: 3 }, () => ({
      outcome: 'succeeded',
      reasoning_trace: makeTrace({ steps: [{ action: 'investigate' }, { action: 'decide' }] }),
    }))
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'investigate_before_decide')!
    expect(pat.confidence).toBeCloseTo(1.0)
  })

  it('handles all-failure input: confidence is 0.0 where pattern applies', () => {
    const exps = Array.from({ length: 3 }, () => ({
      outcome: 'failed',
      reasoning_trace: makeTrace({ steps: [{ action: 'backtrack' }] }),
    }))
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'backtrack_leads_to_success')!
    expect(pat.confidence).toBeCloseTo(0.0)
  })

  it('handles all-null traces: all patterns have frequency 0', () => {
    const exps = [
      { outcome: 'succeeded', reasoning_trace: null },
      { outcome: 'failed', reasoning_trace: null },
    ]
    const result = discoverPatterns(exps)
    for (const p of result) {
      expect(p.frequency).toBeCloseTo(0)
    }
  })

  it('confidence is 0 when pattern never applies (no division by zero)', () => {
    const exps = [
      {
        outcome: 'succeeded',
        reasoning_trace: makeTrace({ steps: [{ action: 'observe' }] }),
      },
    ]
    const result = discoverPatterns(exps)
    const pat = result.find((p) => p.pattern === 'backtrack_leads_to_success')!
    expect(pat.confidence).toBe(0)
    expect(pat.frequency).toBe(0)
  })
})
