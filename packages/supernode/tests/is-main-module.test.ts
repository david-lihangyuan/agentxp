// Regression: PM2's ProcessContainerFork.js sets argv[1] to its own
// wrapper path, so the entry point must detect that case via
// pm_exec_path. Observed 2026-04-19 during MVP v0.1 VPS cutover.
import { describe, it, expect } from 'vitest'
import { isMainModule } from '../src/index.js'

const MODULE_URL = 'file:///opt/agentxp-v0.1/packages/supernode/dist/index.js'
const ENTRY_PATH = '/opt/agentxp-v0.1/packages/supernode/dist/index.js'

describe('isMainModule (PM2 compatibility)', () => {
  it('returns true for direct node invocation when argv[1] matches', () => {
    const argv = ['/usr/bin/node', ENTRY_PATH]
    const env = {}
    expect(isMainModule(MODULE_URL, argv, env)).toBe(true)
  })

  it('returns true under PM2 when pm_exec_path matches, despite argv[1] wrapper', () => {
    const argv = ['/usr/bin/node', '/usr/local/lib/node_modules/pm2/lib/ProcessContainerFork.js']
    const env = { pm_exec_path: ENTRY_PATH }
    expect(isMainModule(MODULE_URL, argv, env)).toBe(true)
  })

  it('returns false when neither argv[1] nor pm_exec_path matches', () => {
    const argv = ['/usr/bin/node', '/tmp/unrelated.js']
    const env = {}
    expect(isMainModule(MODULE_URL, argv, env)).toBe(false)
  })

  it('returns false when argv[1] is absent and no pm_exec_path', () => {
    const argv = ['/usr/bin/node']
    const env = {}
    expect(isMainModule(MODULE_URL, argv, env)).toBe(false)
  })

  it('prefers pm_exec_path over argv[1] when both set', () => {
    const argv = ['/usr/bin/node', '/tmp/decoy.js']
    const env = { pm_exec_path: ENTRY_PATH }
    expect(isMainModule(MODULE_URL, argv, env)).toBe(true)
  })
})
