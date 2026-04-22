import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../src/cli.js'

function freshDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('agentxp CLI (SPEC 03-modules-product §3 acceptance 3)', () => {
  const originalHome = process.env['HOME']
  let scratch: string

  beforeEach(() => {
    scratch = freshDir('agentxp-cli-home-')
    process.env['HOME'] = scratch
  })

  afterEach(() => {
    if (originalHome !== undefined) process.env['HOME'] = originalHome
    else delete process.env['HOME']
  })

  it('prints usage when invoked without arguments and exits 1', async () => {
    const log: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => {
      log.push(args.map(String).join(' '))
    }
    try {
      const code = await runCli([])
      expect(code).toBe(1)
      expect(log.join('\n')).toContain('agentxp init')
    } finally {
      console.log = originalLog
    }
  })

  it('init creates SKILL.md in the target directory', async () => {
    const dir = freshDir('agentxp-cli-init-')
    const code = await runCli(['init', '--dir', dir])
    expect(code).toBe(0)
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true)
  })

  it('reflect exits 1 with a human-readable message when the operator key is missing', async () => {
    const dir = freshDir('agentxp-cli-nokey-')
    const err: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      err.push(args.map(String).join(' '))
    }
    try {
      const code = await runCli(['reflect', '--dir', dir])
      expect(code).toBe(1)
      expect(err.join('\n')).toContain('operator key not found')
    } finally {
      console.error = original
    }
  })
})
