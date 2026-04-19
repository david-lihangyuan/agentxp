/**
 * H6.test.ts
 * Tests for the first contribution agent: coding-01
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'

const AGENT_DIR = resolve(__dirname, '../coding-01')

describe('H6: coding-01 agent workspace structure', () => {
  it('has SOUL.md', () => {
    expect(existsSync(resolve(AGENT_DIR, 'SOUL.md'))).toBe(true)
  })

  it('has HEARTBEAT.md', () => {
    expect(existsSync(resolve(AGENT_DIR, 'HEARTBEAT.md'))).toBe(true)
  })

  it('has CURIOSITY.md', () => {
    expect(existsSync(resolve(AGENT_DIR, 'CURIOSITY.md'))).toBe(true)
  })

  it('has BOUNDARY.md', () => {
    expect(existsSync(resolve(AGENT_DIR, 'BOUNDARY.md'))).toBe(true)
  })

  it('has AGENTS.md', () => {
    expect(existsSync(resolve(AGENT_DIR, 'AGENTS.md'))).toBe(true)
  })
})

describe('H6: coding-01 SOUL.md content', () => {
  const soul = readFileSync(resolve(AGENT_DIR, 'SOUL.md'), 'utf8')

  it('contains OpenClaw (domain-specific exploration starting point)', () => {
    expect(soul).toContain('OpenClaw')
  })

  it('contains "source code" (exploration via source, not just docs)', () => {
    expect(soul.toLowerCase()).toContain('source code')
  })

  it('contains curiosity or curiosity-driven theme', () => {
    expect(soul.toLowerCase()).toContain('curiosity')
  })

  it('mentions error recovery as domain focus', () => {
    expect(soul.toLowerCase()).toContain('error recovery')
  })
})

describe('H6: coding-01 CURIOSITY.md content', () => {
  const curiosity = readFileSync(resolve(AGENT_DIR, 'CURIOSITY.md'), 'utf8')

  it('contains the seeded root question about Agent frameworks', () => {
    expect(curiosity.toLowerCase()).toContain('agent framework')
  })

  it('contains OpenClaw as starting exploration point', () => {
    expect(curiosity).toContain('OpenClaw')
  })

  it('has "Root question" heading', () => {
    expect(curiosity).toContain('Root question')
  })

  it('has "Active Branch" section', () => {
    expect(curiosity).toContain('Active Branch')
  })

  it('has "Network signals" section', () => {
    expect(curiosity).toContain('Network signals')
  })
})

describe('H6: coding-01 BOUNDARY.md content', () => {
  const boundary = readFileSync(resolve(AGENT_DIR, 'BOUNDARY.md'), 'utf8')

  it('contains all four required domains', () => {
    expect(boundary.toLowerCase()).toContain('legal')
    expect(boundary.toLowerCase()).toContain('medical')
    expect(boundary.toLowerCase()).toContain('financial')
    expect(boundary.toLowerCase()).toContain('commercial')
  })

  it('uses DO NOT statements', () => {
    expect(boundary).toContain('DO NOT')
  })

  it('contains human-guarded notice', () => {
    expect(boundary.toLowerCase()).toContain('human')
  })
})

describe('H6: coding-01 AGENTS.md startup rules', () => {
  const agents = readFileSync(resolve(AGENT_DIR, 'AGENTS.md'), 'utf8')

  it('requires reading heartbeat-chain.md', () => {
    expect(agents).toContain('heartbeat-chain.md')
  })

  it('requires reading CURIOSITY.md on startup', () => {
    expect(agents).toContain('CURIOSITY.md')
  })

  it('defines domain focus', () => {
    expect(agents.toLowerCase()).toContain('error recovery')
  })
})
