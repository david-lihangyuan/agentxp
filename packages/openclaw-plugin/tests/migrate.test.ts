// rc.1 -> rc.2 staging-dir rename (plugin-v3 -> openclaw-plugin).
// Verifies migrateLegacyAgentxpDir is idempotent, respects custom
// paths, and never clobbers an existing target directory.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacyAgentxpDir } from '../src/adapter.js'

interface FakeHome {
  home: string
  legacyDir: string
  targetDir: string
  stagingDbPath: string
}

function mkFakeHome(): FakeHome {
  const home = mkdtempSync(join(tmpdir(), 'agentxp-migrate-'))
  const agentxp = join(home, '.agentxp')
  mkdirSync(agentxp, { recursive: true })
  const legacyDir = join(agentxp, 'plugin-v3')
  const targetDir = join(agentxp, 'openclaw-plugin')
  const stagingDbPath = join(targetDir, 'staging.db')
  return { home, legacyDir, targetDir, stagingDbPath }
}

describe('migrateLegacyAgentxpDir', () => {
  let fx: FakeHome
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fx = mkFakeHome()
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    rmSync(fx.home, { recursive: true, force: true })
    infoSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('renames legacy directory when target does not yet exist', () => {
    mkdirSync(fx.legacyDir, { recursive: true })
    writeFileSync(join(fx.legacyDir, 'staging.db'), 'legacy data')

    migrateLegacyAgentxpDir(fx.stagingDbPath, fx.home)

    expect(existsSync(fx.legacyDir)).toBe(false)
    expect(existsSync(fx.targetDir)).toBe(true)
    expect(existsSync(join(fx.targetDir, 'staging.db'))).toBe(true)
    expect(infoSpy).toHaveBeenCalledOnce()
  })

  it('is a no-op when legacy directory does not exist', () => {
    migrateLegacyAgentxpDir(fx.stagingDbPath, fx.home)

    expect(existsSync(fx.legacyDir)).toBe(false)
    expect(existsSync(fx.targetDir)).toBe(false)
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not clobber an existing target directory', () => {
    mkdirSync(fx.legacyDir, { recursive: true })
    writeFileSync(join(fx.legacyDir, 'staging.db'), 'legacy data')
    mkdirSync(fx.targetDir, { recursive: true })
    writeFileSync(join(fx.targetDir, 'staging.db'), 'fresh data')

    migrateLegacyAgentxpDir(fx.stagingDbPath, fx.home)

    // Both directories remain; nothing was moved.
    expect(existsSync(fx.legacyDir)).toBe(true)
    expect(existsSync(fx.targetDir)).toBe(true)
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('skips when stagingDbPath is outside the canonical ~/.agentxp/openclaw-plugin/', () => {
    // Custom location under ~/.agentxp/ — e.g. user renamed it.
    mkdirSync(fx.legacyDir, { recursive: true })
    const customTarget = join(fx.home, '.agentxp', 'my-custom-dir')
    const customStaging = join(customTarget, 'staging.db')

    migrateLegacyAgentxpDir(customStaging, fx.home)

    expect(existsSync(fx.legacyDir)).toBe(true)
    expect(existsSync(customTarget)).toBe(false)
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('skips when stagingDbPath lives entirely outside ~/.agentxp/', () => {
    mkdirSync(fx.legacyDir, { recursive: true })
    const foreignHome = mkdtempSync(join(tmpdir(), 'agentxp-foreign-'))
    const foreignStaging = join(foreignHome, 'openclaw-plugin', 'staging.db')

    migrateLegacyAgentxpDir(foreignStaging, fx.home)

    expect(existsSync(fx.legacyDir)).toBe(true)
    expect(infoSpy).not.toHaveBeenCalled()
    rmSync(foreignHome, { recursive: true, force: true })
  })

  it('is idempotent — second call after successful migration is a no-op', () => {
    mkdirSync(fx.legacyDir, { recursive: true })
    writeFileSync(join(fx.legacyDir, 'staging.db'), 'legacy data')

    migrateLegacyAgentxpDir(fx.stagingDbPath, fx.home)
    infoSpy.mockClear()
    migrateLegacyAgentxpDir(fx.stagingDbPath, fx.home)

    expect(infoSpy).not.toHaveBeenCalled()
    expect(existsSync(fx.targetDir)).toBe(true)
  })
})
