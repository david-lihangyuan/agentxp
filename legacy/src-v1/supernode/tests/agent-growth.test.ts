// agent-growth.test.ts — Tests for computeGrowthProfile (#26)

import { describe, it, expect } from 'vitest'
import { computeGrowthProfile } from '../src/agentxp/agent-growth'
import type { ExperienceInput } from '../src/agentxp/agent-growth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Math.floor(Date.now() / 1000)
const DAY = 86400

function makeTrace(steps: number, deadEnds: number, duration = 'under_1min'): string {
  return JSON.stringify({
    steps: Array.from({ length: steps }, (_, i) => ({
      action: 'investigate',
      content: `step ${i}`,
      significance: 'routine',
    })),
    dead_ends: Array.from({ length: deadEnds }, (_, i) => ({
      step_index: i,
      tried: 'some_approach',
      why_abandoned: 'did not work',
      sensitivity_class: 'public',
    })),
    duration_bucket: duration,
    trace_summary: 'test trace',
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

function makeExp(
  opts: Partial<ExperienceInput> & { daysAgo?: number } = {}
): ExperienceInput {
  const { daysAgo = 5, ...rest } = opts
  return {
    reasoning_trace: makeTrace(4, 1),
    outcome: 'succeeded',
    created_at: NOW - daysAgo * DAY,
    domain_ecosystem: 'software',
    domain_layer: 'backend',
    ...rest,
  }
}

const DOMAIN = { ecosystem: 'software', layer: 'backend' }

// ---------------------------------------------------------------------------
// Basic correctness
// ---------------------------------------------------------------------------

describe('computeGrowthProfile — basic', () => {
  it('returns null for empty experiences', () => {
    const result = computeGrowthProfile([], 'pk-1', DOMAIN, 30)
    expect(result).toBeNull()
  })

  it('returns a profile when there is one matching experience', () => {
    const exps = [makeExp()]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN, 30)
    expect(result).not.toBeNull()
    expect(result!.pubkey).toBe('pk-1')
    expect(result!.experience_count).toBe(1)
  })

  it('sets domain_ecosystem and domain_layer correctly', () => {
    const exps = [makeExp()]
    const result = computeGrowthProfile(exps, 'pk-abc', DOMAIN, 30)!
    expect(result.domain_ecosystem).toBe('software')
    expect(result.domain_layer).toBe('backend')
  })

  it('computes correct success_rate for all successes', () => {
    const exps = [makeExp(), makeExp(), makeExp()]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result.success_rate).toBeCloseTo(1.0)
  })

  it('computes correct success_rate for mixed outcomes', () => {
    const exps = [
      makeExp({ outcome: 'succeeded' }),
      makeExp({ outcome: 'failed' }),
      makeExp({ outcome: 'failed' }),
      makeExp({ outcome: 'succeeded' }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result.success_rate).toBeCloseTo(0.5)
  })

  it('computes avg_steps correctly', () => {
    const exps = [
      makeExp({ reasoning_trace: makeTrace(2, 0) }),
      makeExp({ reasoning_trace: makeTrace(6, 0) }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result.avg_steps).toBeCloseTo(4)
  })

  it('computes avg_dead_ends correctly', () => {
    const exps = [
      makeExp({ reasoning_trace: makeTrace(3, 0) }),
      makeExp({ reasoning_trace: makeTrace(3, 4) }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result.avg_dead_ends).toBeCloseTo(2)
  })

  it('handles experiences with no reasoning_trace (null)', () => {
    const exps = [
      makeExp({ reasoning_trace: null }),
      makeExp({ reasoning_trace: null }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result).not.toBeNull()
    expect(result.avg_steps).toBe(0)
    expect(result.avg_dead_ends).toBe(0)
  })

  it('handles experiences with invalid JSON trace (graceful skip)', () => {
    const exps = [
      makeExp({ reasoning_trace: 'not-valid-json' }),
      makeExp({ reasoning_trace: makeTrace(4, 2) }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    // Only one trace parses; avg_steps = (0 + 4) / 2 = 2
    expect(result.avg_steps).toBeCloseTo(2)
  })
})

// ---------------------------------------------------------------------------
// Domain filtering
// ---------------------------------------------------------------------------

describe('computeGrowthProfile — domain filtering', () => {
  it('returns null when no experiences match the requested domain', () => {
    const exps = [makeExp({ domain_ecosystem: 'infra', domain_layer: 'k8s' })]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN, 30)
    expect(result).toBeNull()
  })

  it('filters to only the requested domain', () => {
    const exps = [
      makeExp({ domain_ecosystem: 'software', domain_layer: 'backend' }),
      makeExp({ domain_ecosystem: 'infra', domain_layer: 'k8s' }),
      makeExp({ domain_ecosystem: 'software', domain_layer: 'backend' }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN, 30)!
    expect(result.experience_count).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Time window filtering
// ---------------------------------------------------------------------------

describe('computeGrowthProfile — time window', () => {
  it('returns null when all experiences are older than periodDays', () => {
    const exps = [makeExp({ daysAgo: 60 })]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN, 30)
    expect(result).toBeNull()
  })

  it('only includes experiences within the periodDays window', () => {
    const exps = [
      makeExp({ daysAgo: 5 }),
      makeExp({ daysAgo: 10 }),
      makeExp({ daysAgo: 40 }),  // outside window
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN, 30)!
    expect(result.experience_count).toBe(2)
  })

  it('uses default periodDays=30 when not specified', () => {
    const exps = [makeExp({ daysAgo: 25 }), makeExp({ daysAgo: 35 })]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result.experience_count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Trend detection
// ---------------------------------------------------------------------------

describe('computeGrowthProfile — trend', () => {
  it('returns stable for a single experience', () => {
    const result = computeGrowthProfile([makeExp()], 'pk-1', DOMAIN)!
    expect(result.trend).toBe('stable')
  })

  it('detects improving trend: step count drops ≥20% and success does not decline', () => {
    // First half: 10 steps; second half: 6 steps (40% reduction) — improving
    const exps = [
      makeExp({ reasoning_trace: makeTrace(10, 0), daysAgo: 20, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(10, 0), daysAgo: 18, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(6, 0), daysAgo: 5, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(6, 0), daysAgo: 3, outcome: 'succeeded' }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result.trend).toBe('improving')
  })

  it('detects degrading trend: step count increases ≥20%', () => {
    // First half: 4 steps; second half: 8 steps (100% increase) — degrading
    const exps = [
      makeExp({ reasoning_trace: makeTrace(4, 0), daysAgo: 20, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(4, 0), daysAgo: 18, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(8, 0), daysAgo: 5, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(8, 0), daysAgo: 3, outcome: 'succeeded' }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result.trend).toBe('degrading')
  })

  it('detects degrading trend: success rate drops ≥20%', () => {
    // First half: 100% success; second half: 0% (drop >= 20%) — degrading
    const exps = [
      makeExp({ reasoning_trace: makeTrace(4, 0), daysAgo: 20, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(4, 0), daysAgo: 18, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(4, 0), daysAgo: 5, outcome: 'failed' }),
      makeExp({ reasoning_trace: makeTrace(4, 0), daysAgo: 3, outcome: 'failed' }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result.trend).toBe('degrading')
  })

  it('returns stable when changes are below thresholds', () => {
    // Steps vary by < 20% (10 → 11, ~10%), success rate same — stable
    const exps = [
      makeExp({ reasoning_trace: makeTrace(10, 0), daysAgo: 20, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(10, 0), daysAgo: 18, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(11, 0), daysAgo: 5, outcome: 'succeeded' }),
      makeExp({ reasoning_trace: makeTrace(11, 0), daysAgo: 3, outcome: 'succeeded' }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    expect(result.trend).toBe('stable')
  })
})

// ---------------------------------------------------------------------------
// Duration / avg_duration_seconds
// ---------------------------------------------------------------------------

describe('computeGrowthProfile — duration', () => {
  it('maps duration_bucket to seconds correctly', () => {
    const exps = [
      makeExp({ reasoning_trace: makeTrace(3, 0, 'under_1min') }),
      makeExp({ reasoning_trace: makeTrace(3, 0, '1_to_5min') }),
    ]
    const result = computeGrowthProfile(exps, 'pk-1', DOMAIN)!
    // (30 + 180) / 2 = 105
    expect(result.avg_duration_seconds).toBeCloseTo(105)
  })
})
