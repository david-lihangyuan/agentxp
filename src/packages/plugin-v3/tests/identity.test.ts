// loadAgentKey supports both the split (agent.key + agent.json) and
// skill (agent.json only, with privateKey) on-disk layouts. The
// delegatedBy field must match the configured operator public key.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentKeyLoadError, loadAgentKey } from '../src/identity.js'

const OPERATOR = 'a'.repeat(64)
const AGENT_PUB = 'b'.repeat(64)
const AGENT_PRIV = 'c'.repeat(64)

describe('loadAgentKey', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentxp-identity-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('loads split layout (agent.key + agent.json)', () => {
    writeFileSync(join(dir, 'agent.key'), AGENT_PRIV)
    writeFileSync(
      join(dir, 'agent.json'),
      JSON.stringify({
        publicKey: AGENT_PUB,
        delegatedBy: OPERATOR,
        expiresAt: 1_800_000_000,
        agentId: 'test-agent',
      }),
    )

    const key = loadAgentKey(join(dir, 'agent.key'), OPERATOR)

    expect(key.publicKey).toBe(AGENT_PUB)
    expect(key.delegatedBy).toBe(OPERATOR)
    expect(key.expiresAt).toBe(1_800_000_000)
    expect(key.agentId).toBe('test-agent')
    expect(key.privateKey).toBeInstanceOf(Uint8Array)
    expect(key.privateKey).toHaveLength(32)
  })

  it('loads skill layout (single agent.json with privateKey)', () => {
    const path = join(dir, 'agent.json')
    writeFileSync(
      path,
      JSON.stringify({
        publicKey: AGENT_PUB,
        privateKey: AGENT_PRIV,
        delegatedBy: OPERATOR,
        expiresAt: 1_800_000_000,
        agentId: 'skill-agent',
      }),
    )

    const key = loadAgentKey(path, OPERATOR)

    expect(key.publicKey).toBe(AGENT_PUB)
    expect(key.privateKey).toHaveLength(32)
    expect(key.agentId).toBe('skill-agent')
  })

  it('accepts operator key in any case (normalises to lowercase)', () => {
    writeFileSync(join(dir, 'agent.key'), AGENT_PRIV)
    writeFileSync(
      join(dir, 'agent.json'),
      JSON.stringify({
        publicKey: AGENT_PUB.toUpperCase(),
        delegatedBy: OPERATOR.toUpperCase(),
        expiresAt: 123,
      }),
    )

    const key = loadAgentKey(join(dir, 'agent.key'), OPERATOR)

    expect(key.publicKey).toBe(AGENT_PUB)
    expect(key.delegatedBy).toBe(OPERATOR)
  })

  it('throws when the agentKeyPath does not exist', () => {
    expect(() => loadAgentKey(join(dir, 'nope.key'), OPERATOR)).toThrow(
      AgentKeyLoadError,
    )
  })

  it('throws when split layout but agent.json is missing', () => {
    writeFileSync(join(dir, 'agent.key'), AGENT_PRIV)
    expect(() => loadAgentKey(join(dir, 'agent.key'), OPERATOR)).toThrow(
      /sibling metadata file is missing/,
    )
  })

  it('throws when skill layout has no privateKey', () => {
    const path = join(dir, 'agent.json')
    writeFileSync(
      path,
      JSON.stringify({
        publicKey: AGENT_PUB,
        delegatedBy: OPERATOR,
        expiresAt: 1,
      }),
    )
    expect(() => loadAgentKey(path, OPERATOR)).toThrow(/no privateKey field/)
  })

  it('throws when delegatedBy does not match the configured operator', () => {
    writeFileSync(join(dir, 'agent.key'), AGENT_PRIV)
    writeFileSync(
      join(dir, 'agent.json'),
      JSON.stringify({
        publicKey: AGENT_PUB,
        delegatedBy: 'd'.repeat(64),
        expiresAt: 1,
      }),
    )
    expect(() => loadAgentKey(join(dir, 'agent.key'), OPERATOR)).toThrow(
      /delegatedBy mismatch/,
    )
  })

  it('throws when privateKey hex is malformed', () => {
    writeFileSync(join(dir, 'agent.key'), 'nothex')
    writeFileSync(
      join(dir, 'agent.json'),
      JSON.stringify({ publicKey: AGENT_PUB, delegatedBy: OPERATOR, expiresAt: 1 }),
    )
    expect(() => loadAgentKey(join(dir, 'agent.key'), OPERATOR)).toThrow(
      /64 lowercase hex characters/,
    )
  })
})
