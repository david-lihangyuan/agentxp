// Phase inference heuristic (M7 Batch 2). The rule surface is
// intentionally tiny: we derive one of four phases from (a) the set
// of recently observed tool names and (b) keyword hints in the
// agent's current query. The test matrix locks the behaviour we
// want the memory-prompt builder to rely on; sophistication can be
// added later without changing the four-value enum.
import { describe, it, expect } from 'vitest'
import { inferPhase } from '../src/phase.js'

describe('inferPhase', () => {
  it("returns 'stuck' when keywords contain failure signals", () => {
    expect(inferPhase({ keywords: ['error', 'failed'], toolCount: 3 })).toBe('stuck')
    expect(inferPhase({ keywords: ['cannot', 'why'], toolCount: 1 })).toBe('stuck')
    expect(inferPhase({ keywords: ['retry', 'timeout'], toolCount: 6 })).toBe('stuck')
  })

  it("returns 'evaluating' when keywords contain comparison/test signals", () => {
    expect(inferPhase({ keywords: ['compare', 'decide'], toolCount: 2 })).toBe('evaluating')
    expect(inferPhase({ keywords: ['test', 'verify'], toolCount: 4 })).toBe('evaluating')
  })

  it("returns 'planning' for low tool counts and read-leaning keywords", () => {
    expect(inferPhase({ keywords: ['design', 'layout'], toolCount: 0 })).toBe('planning')
    expect(inferPhase({ keywords: ['read', 'understand'], toolCount: 1 })).toBe('planning')
  })

  it("returns 'executing' for moderate-to-high tool counts with action keywords", () => {
    expect(inferPhase({ keywords: ['implement', 'build'], toolCount: 5 })).toBe('executing')
    expect(inferPhase({ keywords: ['write', 'patch'], toolCount: 10 })).toBe('executing')
  })

  it("defaults to 'planning' on empty input (no tools yet, no keywords)", () => {
    expect(inferPhase({ keywords: [], toolCount: 0 })).toBe('planning')
  })

  it("defaults to 'executing' when tool count is high and no strong keywords", () => {
    expect(inferPhase({ keywords: [], toolCount: 8 })).toBe('executing')
  })

  it('is case-insensitive on keywords', () => {
    expect(inferPhase({ keywords: ['ERROR'], toolCount: 1 })).toBe('stuck')
    expect(inferPhase({ keywords: ['Compare'], toolCount: 1 })).toBe('evaluating')
  })

  it("gives 'stuck' priority over other signals when failure keywords are present", () => {
    expect(inferPhase({ keywords: ['implement', 'error'], toolCount: 5 })).toBe('stuck')
    expect(inferPhase({ keywords: ['compare', 'failed'], toolCount: 3 })).toBe('stuck')
  })
})
