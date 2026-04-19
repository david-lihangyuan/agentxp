import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const SPEC_PATH = join(__dirname, '../../docs/spec/serendip-protocol-v1.md')

describe('I2: Serendip Protocol v1 Spec', () => {
  it('spec file exists', () => {
    expect(existsSync(SPEC_PATH)).toBe(true)
  })

  it('contains Overview section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('## Overview')
  })

  it('contains Event Format section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('## Event Format')
  })

  it('contains Kind Definitions section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('## Kind Definitions')
  })

  it('contains Signing Algorithm section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('## Signing Algorithm')
  })

  it('contains Relay Interface section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('## Relay Interface')
  })

  it('contains How to Register a New Kind section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('## How to Register a New Kind')
  })

  it('contains SIP Process section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('## SIP Process')
  })

  it('contains §10 Fairness Charter section', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('§10 Fairness Charter')
  })

  it('§10 explicitly states it cannot be modified by any SIP', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('cannot be modified by any SIP')
  })

  it('§10 includes anti-gaming rules (same operator = 0 points)', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('same operator')
    expect(content).toContain('0 points')
  })

  it('event format includes all required fields', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('"id"')
    expect(content).toContain('"pubkey"')
    expect(content).toContain('"created_at"')
    expect(content).toContain('"kind"')
    expect(content).toContain('"payload"')
    expect(content).toContain('"sig"')
    expect(content).toContain('"v"')
  })

  it('mentions Ed25519 signing', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('Ed25519')
  })

  it('mentions domain ownership verification for kind registration', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    expect(content).toContain('domain ownership')
  })
})
