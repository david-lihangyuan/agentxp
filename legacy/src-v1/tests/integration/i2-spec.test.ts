// I2: Protocol Spec Document Test
// Verifies the formal protocol spec file exists and contains all required sections.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SPEC_PATH = join(
  new URL('.', import.meta.url).pathname,
  '../../docs/spec/serendip-protocol-v1.md'
)

describe('I2: Protocol Spec Document', () => {
  it('spec file exists at docs/spec/serendip-protocol-v1.md', () => {
    expect(existsSync(SPEC_PATH)).toBe(true)
  })

  it('spec contains Event Format section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content.toLowerCase()).toContain('event format')
  })

  it('spec contains Kind Definitions section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content.toLowerCase()).toContain('kind definition')
  })

  it('spec contains Signing Algorithm section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content.toLowerCase()).toContain('signing algorithm')
  })

  it('spec contains Relay Interface section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content.toLowerCase()).toContain('relay interface')
  })

  it('spec contains kind registration process', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    // Should mention how to register a new kind
    expect(content.toLowerCase()).toMatch(/register.*kind|kind.*registr/)
  })

  it('spec contains SIP (Serendip Improvement Proposal) process', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('SIP')
  })

  it('spec contains §10 Fairness Charter', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    // Must have a section 10 or a section called "Fairness Charter"
    expect(content.toLowerCase()).toContain('fairness charter')
  })

  it('§10 Fairness Charter cannot be modified by any SIP', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    // The spec must explicitly state this
    expect(content.toLowerCase()).toContain('cannot be modified by any sip')
  })

  it('spec contains anti-gaming rules in §10', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    // Anti-gaming or gaming section should be present
    expect(content.toLowerCase()).toMatch(/anti.gaming|gaming|manipulation/)
  })

  it('spec has a meaningful introduction or overview', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content.length).toBeGreaterThan(5000) // At minimum 5KB of content
  })
})
