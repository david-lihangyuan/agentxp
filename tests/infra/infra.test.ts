/**
 * Phase I (I3–I8) Infrastructure Tests
 *
 * TDD spec: docs/plans/2026-04-12-phase-fghi-tdd-spec.md
 * All tests run from: tests/infra/
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { execSync } from 'child_process'

// Resolve repo root relative to this test file (tests/infra → ../../)
const ROOT = resolve(__dirname, '../../')

// ---------------------------------------------------------------------------
// I3 — setup-dev.sh
// ---------------------------------------------------------------------------
describe('I3: setup-dev.sh', () => {
  const SCRIPT = join(ROOT, 'scripts/setup-dev.sh')

  it('file exists', () => {
    expect(existsSync(SCRIPT)).toBe(true)
  })

  it('is executable (mode has +x)', () => {
    const mode = statSync(SCRIPT).mode
    // Check owner execute bit (0o100)
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('contains "npm install"', () => {
    const content = readFileSync(SCRIPT, 'utf8')
    expect(content).toContain('npm install')
  })

  it('contains "migrations"', () => {
    const content = readFileSync(SCRIPT, 'utf8')
    expect(content).toContain('migrations')
  })

  it('contains relay start command', () => {
    const content = readFileSync(SCRIPT, 'utf8')
    expect(content).toMatch(/relay|supernode/)
  })
})

// ---------------------------------------------------------------------------
// I4 — CI Pipeline
// ---------------------------------------------------------------------------
describe('I4: CI Pipeline', () => {
  const PR_YML = join(ROOT, '.github/workflows/pr.yml')
  const RELEASE_YML = join(ROOT, '.github/workflows/release.yml')

  describe('pr.yml', () => {
    it('file exists', () => {
      expect(existsSync(PR_YML)).toBe(true)
    })

    it('contains --frozen-lockfile (lockfile drift prevention)', () => {
      expect(readFileSync(PR_YML, 'utf8')).toContain('--frozen-lockfile')
    })

    it('contains tsc / typecheck step', () => {
      const content = readFileSync(PR_YML, 'utf8')
      expect(content).toMatch(/tsc|typecheck/)
    })

    it('contains vitest run step', () => {
      const content = readFileSync(PR_YML, 'utf8')
      expect(content).toContain('vitest')
    })

    it('contains integration test step', () => {
      const content = readFileSync(PR_YML, 'utf8')
      expect(content).toContain('integration')
    })

    it('contains npm audit step', () => {
      const content = readFileSync(PR_YML, 'utf8')
      expect(content).toContain('npm audit')
    })
  })

  describe('release.yml', () => {
    it('file exists', () => {
      expect(existsSync(RELEASE_YML)).toBe(true)
    })

    it('contains provenance', () => {
      expect(readFileSync(RELEASE_YML, 'utf8')).toContain('provenance')
    })

    it('contains docker', () => {
      expect(readFileSync(RELEASE_YML, 'utf8')).toContain('docker')
    })

    it('contains clawhub publish step', () => {
      expect(readFileSync(RELEASE_YML, 'utf8')).toContain('clawhub')
    })
  })
})

// ---------------------------------------------------------------------------
// I5 — CONTRIBUTING.md
// ---------------------------------------------------------------------------
describe('I5: CONTRIBUTING.md', () => {
  const FILE = join(ROOT, 'CONTRIBUTING.md')

  it('file exists', () => {
    expect(existsSync(FILE)).toBe(true)
  })

  it('contains branch strategy (main/develop/feature/fix/hotfix)', () => {
    const c = readFileSync(FILE, 'utf8')
    expect(c).toContain('main')
    expect(c).toContain('develop')
    expect(c).toContain('feature')
    expect(c).toContain('fix')
    expect(c).toContain('hotfix')
  })

  it('contains PR requirements section', () => {
    const c = readFileSync(FILE, 'utf8')
    expect(c).toMatch(/PR\s*[Rr]equirements|Pull Request/)
  })

  it('contains hotfix process section', () => {
    const c = readFileSync(FILE, 'utf8')
    expect(c).toContain('hotfix')
  })

  it('contains kind registration section with domain ownership', () => {
    const c = readFileSync(FILE, 'utf8')
    expect(c).toContain('kind registration')
    expect(c).toContain('domain ownership')
  })

  it('contains code style section', () => {
    const c = readFileSync(FILE, 'utf8')
    expect(c).toMatch(/[Cc]ode [Ss]tyle|code style/)
  })

  it('references §10 as immutable', () => {
    const c = readFileSync(FILE, 'utf8')
    expect(c).toContain('§10')
  })
})

// ---------------------------------------------------------------------------
// I6 — CHANGELOG.md
// ---------------------------------------------------------------------------
describe('I6: CHANGELOG.md', () => {
  const FILE = join(ROOT, 'CHANGELOG.md')

  it('file exists', () => {
    expect(existsSync(FILE)).toBe(true)
  })

  it('contains v4.0.0 entry', () => {
    expect(readFileSync(FILE, 'utf8')).toContain('4.0.0')
  })

  it('contains Unreleased / template section for future entries', () => {
    const c = readFileSync(FILE, 'utf8')
    expect(c).toMatch(/\[Unreleased\]|## Unreleased|template/)
  })
})

// ---------------------------------------------------------------------------
// I7 — Kind Registry
// ---------------------------------------------------------------------------
describe('I7: Kind Registry', () => {
  const KINDS_DIR = join(ROOT, 'kind-registry/kinds')
  const EXPERIENCE_JSON = join(KINDS_DIR, 'io.agentxp.experience.json')
  const README = join(ROOT, 'kind-registry/README.md')
  const VALIDATE_YML = join(ROOT, 'kind-registry/.github/workflows/validate.yml')
  const SIP_MD = join(ROOT, '.github/ISSUE_TEMPLATE/sip.md')

  it('io.agentxp.experience.json exists', () => {
    expect(existsSync(EXPERIENCE_JSON)).toBe(true)
  })

  it('io.agentxp.experience.json is valid JSON', () => {
    const content = readFileSync(EXPERIENCE_JSON, 'utf8')
    expect(() => JSON.parse(content)).not.toThrow()
  })

  it('io.agentxp.experience.json is a valid JSON Schema (has $schema / type)', () => {
    const schema = JSON.parse(readFileSync(EXPERIENCE_JSON, 'utf8'))
    // Must have $schema or type indicating it's a JSON Schema
    const hasSchema = schema['$schema'] || schema['type'] || schema['properties']
    expect(hasSchema).toBeTruthy()
  })

  it('kind-registry/README.md exists', () => {
    expect(existsSync(README)).toBe(true)
  })

  it('README mentions domain ownership verification', () => {
    const c = readFileSync(README, 'utf8')
    expect(c).toContain('domain ownership')
  })

  it('README mentions naming convention', () => {
    const c = readFileSync(README, 'utf8')
    expect(c).toMatch(/naming convention|reverse-DNS|reverse DNS/)
  })

  it('kind-registry/.github/workflows/validate.yml exists', () => {
    expect(existsSync(VALIDATE_YML)).toBe(true)
  })

  it('validate.yml contains schema validation step', () => {
    const c = readFileSync(VALIDATE_YML, 'utf8')
    expect(c).toMatch(/schema|validate|ajv/)
  })

  it('.github/ISSUE_TEMPLATE/sip.md exists', () => {
    expect(existsSync(SIP_MD)).toBe(true)
  })

  it('sip.md references §10 as immutable', () => {
    const c = readFileSync(SIP_MD, 'utf8')
    expect(c).toContain('§10')
  })

  it('sip.md has backward compatibility section', () => {
    const c = readFileSync(SIP_MD, 'utf8')
    expect(c).toMatch(/backward compat|backwards compat|Backward Compat/)
  })
})

// ---------------------------------------------------------------------------
// I8 — AgentXP CLI
// ---------------------------------------------------------------------------
describe('I8: AgentXP CLI', () => {
  const CLI = join(ROOT, 'packages/skill/src/cli.ts')

  it('cli.ts exists', () => {
    expect(existsSync(CLI)).toBe(true)
  })

  it('contains dashboard command', () => {
    expect(readFileSync(CLI, 'utf8')).toContain('dashboard')
  })

  it('contains status command', () => {
    expect(readFileSync(CLI, 'utf8')).toContain('status')
  })

  it('contains config command', () => {
    expect(readFileSync(CLI, 'utf8')).toContain('config')
  })

  it('contains update command', () => {
    expect(readFileSync(CLI, 'utf8')).toContain('update')
  })

  it('missing workspace gives helpful error (not stack trace)', () => {
    const content = readFileSync(CLI, 'utf8')
    // Should have a user-friendly error message, not just throw/Error
    expect(content).toMatch(
      /workspace not found|not found|No workspace|missing workspace|could not find workspace/i
    )
  })

  it('--help is handled', () => {
    const content = readFileSync(CLI, 'utf8')
    expect(content).toMatch(/--help|help/)
  })
})

// ---------------------------------------------------------------------------
// Bundle size test — @serendip/protocol < 50KB
// ---------------------------------------------------------------------------
describe('Bundle size: @serendip/protocol < 50KB', () => {
  const PROTOCOL_SRC = join(ROOT, 'packages/protocol/src/index.ts')
  const BUNDLE_OUT = join(ROOT, 'tests/infra/.tmp-bundle/protocol.bundle.js')

  beforeAll(() => {
    // Build with esbuild (fastest, available via npx)
    const outDir = join(ROOT, 'tests/infra/.tmp-bundle')
    try {
      execSync(
        `npx --yes esbuild ${PROTOCOL_SRC} --bundle --format=esm --outfile=${BUNDLE_OUT} --platform=node --minify --tree-shaking=true 2>&1`,
        { cwd: ROOT, stdio: 'pipe', timeout: 30000 }
      )
    } catch (e) {
      // esbuild failure is reported in the bundle size test itself
    }
  })

  it('@serendip/protocol source index exists', () => {
    expect(existsSync(PROTOCOL_SRC)).toBe(true)
  })

  it('bundle output file was created', () => {
    expect(existsSync(BUNDLE_OUT)).toBe(true)
  })

  it('bundle size < 50KB', () => {
    const size = statSync(BUNDLE_OUT).size
    const kb = size / 1024
    console.log(`Bundle size: ${kb.toFixed(2)} KB`)
    expect(kb).toBeLessThan(50)
  })
})
