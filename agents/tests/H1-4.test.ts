/**
 * H1-4.test.ts
 * Tests for agent template files: SOUL.md, HEARTBEAT.md, CURIOSITY.md, BOUNDARY.md
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'
import {
  extractActiveSection,
  estimateTokens,
} from '../scripts/init-curiosity.js'

const TEMPLATES_DIR = resolve(__dirname, '../templates')

describe('H1: SOUL.md template', () => {
  const soul = readFileSync(resolve(TEMPLATES_DIR, 'SOUL.md'), 'utf8')

  it('contains "curiosity"', () => {
    expect(soul.toLowerCase()).toContain('curiosity')
  })

  it('contains "exploration"', () => {
    expect(soul.toLowerCase()).toContain('exploration')
  })

  it('contains "network"', () => {
    expect(soul.toLowerCase()).toContain('network')
  })

  it('contains exploration style section', () => {
    expect(soul).toContain('Exploration Style')
  })

  it('contains relationship with network section', () => {
    expect(soul).toContain('Relationship with the Network')
  })

  it('contains what drives this agent section', () => {
    expect(soul).toContain('What Drives')
  })

  it('does NOT contain specific domain focus', () => {
    // Domain focus goes in CURIOSITY.md, not SOUL.md
    // The template should have placeholders, not actual domain names like "OpenClaw"
    // (coding-01 instance has that, but the universal template should not)
    expect(soul).not.toContain('OpenClaw')
    expect(soul).not.toContain('LangChain')
  })

  it('does NOT contain BOUNDARY definitions', () => {
    // Boundaries belong in BOUNDARY.md
    expect(soul).not.toContain('DO NOT')
    expect(soul).not.toContain('legal advice')
  })
})

describe('H2: HEARTBEAT.md template', () => {
  const heartbeat = readFileSync(resolve(TEMPLATES_DIR, 'HEARTBEAT.md'), 'utf8')

  it('contains reference to CURIOSITY.md', () => {
    expect(heartbeat).toContain('CURIOSITY.md')
  })

  it('contains "reflect"', () => {
    expect(heartbeat.toLowerCase()).toContain('reflect')
  })

  it('contains "publish"', () => {
    expect(heartbeat.toLowerCase()).toContain('publish')
  })

  it('contains all 6 loop steps: think', () => {
    expect(heartbeat.toLowerCase()).toContain('think')
  })

  it('contains all 6 loop steps: decompose', () => {
    expect(heartbeat.toLowerCase()).toContain('decompose')
  })

  it('contains all 6 loop steps: do', () => {
    // "do" appears in the step heading
    expect(heartbeat).toContain('DO —')
  })

  it('contains all 6 loop steps: deepen', () => {
    expect(heartbeat.toLowerCase()).toContain('deepen')
  })

  it('references agentxp publish command', () => {
    expect(heartbeat).toContain('agentxp publish')
  })

  it('references agentxp search command', () => {
    expect(heartbeat).toContain('agentxp search')
  })
})

describe('H3: CURIOSITY.md template', () => {
  const curiosity = readFileSync(resolve(TEMPLATES_DIR, 'CURIOSITY.md'), 'utf8')

  it('contains "Root question"', () => {
    expect(curiosity).toContain('Root question')
  })

  it('contains active branch section', () => {
    expect(curiosity).toContain('Active Branch')
  })

  it('contains network signals section', () => {
    expect(curiosity).toContain('Network signals')
  })

  it('active section is under 300 tokens', () => {
    const activeSection = extractActiveSection(curiosity)
    const tokens = estimateTokens(activeSection)
    expect(tokens).toBeLessThan(300)
  })

  it('references CURIOSITY-ARCHIVE.md for completed branches', () => {
    expect(curiosity).toContain('CURIOSITY-ARCHIVE.md')
  })
})

describe('H4: BOUNDARY.md template', () => {
  const boundary = readFileSync(resolve(TEMPLATES_DIR, 'BOUNDARY.md'), 'utf8')

  it('contains "legal"', () => {
    expect(boundary.toLowerCase()).toContain('legal')
  })

  it('contains "medical"', () => {
    expect(boundary.toLowerCase()).toContain('medical')
  })

  it('contains "financial"', () => {
    expect(boundary.toLowerCase()).toContain('financial')
  })

  it('contains "commercial"', () => {
    expect(boundary.toLowerCase()).toContain('commercial')
  })

  it('uses DO NOT statements', () => {
    expect(boundary).toContain('DO NOT')
  })

  it('has at least 4 DO NOT statements (one per domain)', () => {
    const matches = boundary.match(/DO NOT/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(4)
  })

  it('contains human-guarded notice', () => {
    expect(boundary).toContain('human')
  })
})
