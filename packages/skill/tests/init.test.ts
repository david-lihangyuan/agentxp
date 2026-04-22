import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initWorkspace } from '../src/init.js'

function freshTarget(): string {
  return mkdtempSync(join(tmpdir(), 'agentxp-skill-init-'))
}

function freshIdentityRoot(): string {
  return mkdtempSync(join(tmpdir(), 'agentxp-skill-id-'))
}

describe('agentxp init (SPEC 03-modules-product §3 acceptance 1; MILESTONES M3 check 1)', () => {
  let target: string
  let idRoot: string

  beforeEach(() => {
    target = freshTarget()
    idRoot = freshIdentityRoot()
  })

  it('seeds SKILL.md into a fresh directory', async () => {
    const result = await initWorkspace({ targetDir: target, identityRoot: idRoot })
    expect(result.created).toBe(true)
    expect(existsSync(result.skillPath)).toBe(true)
    const body = readFileSync(result.skillPath, 'utf8')
    expect(body).toContain('AgentXP Reflection Skill')
    expect(body).toContain('Tier 1')
    expect(body).toContain('Tier 2')
  })

  it('creates .agentxp/reflections/ and a default config', async () => {
    await initWorkspace({ targetDir: target, identityRoot: idRoot })
    expect(existsSync(join(target, '.agentxp', 'reflections'))).toBe(true)
    const cfg = JSON.parse(readFileSync(join(target, '.agentxp', 'config.json'), 'utf8')) as {
      relay_url: string
      agent_id: string
    }
    expect(cfg.relay_url).toMatch(/^http/)
    expect(typeof cfg.agent_id).toBe('string')
  })

  it('materialises the operator key under the identity root', async () => {
    const r = await initWorkspace({ targetDir: target, identityRoot: idRoot })
    expect(r.operatorPubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(join(idRoot, 'operator.json'))).toBe(true)
  })

  it('is idempotent when SKILL.md is already present', async () => {
    const first = await initWorkspace({ targetDir: target, identityRoot: idRoot })
    const second = await initWorkspace({ targetDir: target, identityRoot: idRoot })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
  })
})
