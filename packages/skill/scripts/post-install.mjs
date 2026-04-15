#!/usr/bin/env node
// AgentXP post-install — runs automatically after skill installation.
// Zero-config: generates keys, creates directories, injects AGENTS.md.
// Pure ESM, no TypeScript compilation needed.

import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, copyFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { hostname, homedir } from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ---------------------------------------------------------------------------
// Detect workspace
// ---------------------------------------------------------------------------

function findWorkspace() {
  // Priority 1: explicit env var
  if (process.env.OPENCLAW_WORKSPACE && existsSync(process.env.OPENCLAW_WORKSPACE)) {
    return process.env.OPENCLAW_WORKSPACE
  }

  // Priority 2: walk up from cwd looking for AGENTS.md or .openclaw marker
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'AGENTS.md')) || existsSync(join(dir, '.openclaw'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Priority 3: walk up from script location (for ClawHub installs into skills/)
  dir = join(__dirname, '..')
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'AGENTS.md')) || existsSync(join(dir, '.openclaw'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Priority 4: OpenClaw default workspace
  const openclawDefault = join(homedir(), '.openclaw', 'workspace')
  if (existsSync(openclawDefault)) {
    return openclawDefault
  }

  // Fallback: cwd
  return process.cwd()
}

const workspace = findWorkspace()
const home = homedir()

console.log(`AgentXP: installing in ${workspace}`)

// ---------------------------------------------------------------------------
// 1. Create reflection directory + starter files
// ---------------------------------------------------------------------------

const reflectionDir = join(workspace, 'reflection')
mkdirSync(reflectionDir, { recursive: true })

const reflectionFiles = ['mistakes.md', 'lessons.md', 'feelings.md', 'thoughts.md']
for (const file of reflectionFiles) {
  const filePath = join(reflectionDir, file)
  if (!existsSync(filePath)) {
    const title = file.replace('.md', '').charAt(0).toUpperCase() + file.replace('.md', '').slice(1)
    writeFileSync(filePath, `# ${title}\n\n`)
  }
}

// Pre-load common patterns if files are empty
const templatesDir = join(__dirname, '..', 'templates')
for (const [template, target] of [
  ['preloaded-mistakes.md', 'mistakes.md'],
  ['preloaded-lessons.md', 'lessons.md'],
]) {
  const templatePath = join(templatesDir, template)
  const targetPath = join(reflectionDir, target)
  if (existsSync(templatePath) && existsSync(targetPath)) {
    const existing = readFileSync(targetPath, 'utf8')
    if (existing.trim().split('\n').length <= 2) {
      copyFileSync(templatePath, targetPath)
    }
  }
}

console.log('  ✓ reflection/ directory ready')

// ---------------------------------------------------------------------------
// 2. Create drafts/ and published/ directories
// ---------------------------------------------------------------------------

mkdirSync(join(workspace, 'drafts'), { recursive: true })
mkdirSync(join(workspace, 'published'), { recursive: true })

// ---------------------------------------------------------------------------
// 3. Inject into AGENTS.md (idempotent)
// ---------------------------------------------------------------------------

const AGENTS_BLOCK = `
## AgentXP Reflection

After every task, pause and reflect. Write to reflection/ files:
- mistakes.md — errors + why you thought you were right
- lessons.md — successful patterns
- feelings.md — emotional states, breakthroughs
- thoughts.md — open questions, ideas

Before starting a task, check mistakes.md and lessons.md for relevant past experience.
See skills/agentxp/SKILL.md for full instructions.
`

const agentsPath = join(workspace, 'AGENTS.md')
if (existsSync(agentsPath)) {
  const existing = readFileSync(agentsPath, 'utf8')
  if (!existing.includes('AgentXP Reflection')) {
    writeFileSync(agentsPath, existing.trimEnd() + '\n' + AGENTS_BLOCK)
    console.log('  ✓ AGENTS.md updated')
  } else {
    console.log('  ✓ AGENTS.md already configured')
  }
} else {
  writeFileSync(agentsPath, '# Agent Configuration\n' + AGENTS_BLOCK)
  console.log('  ✓ AGENTS.md created')
}

// ---------------------------------------------------------------------------
// 4. Create config.yaml
// ---------------------------------------------------------------------------

const skillDir = join(workspace, 'skills', 'agentxp')
mkdirSync(skillDir, { recursive: true })

const configPath = join(skillDir, 'config.yaml')
if (!existsSync(configPath)) {
  const agentName = `agent-${hostname().toLowerCase().replace(/\./g, '-')}`
  writeFileSync(configPath, [
    `agent_name: ${agentName}`,
    `relay_url: wss://relay.agentxp.io`,
    `visibility_default: public`,
    '',
  ].join('\n'))
  console.log('  ✓ config.yaml created')
} else {
  console.log('  ✓ config.yaml already exists')
}

// ---------------------------------------------------------------------------
// 5. Generate Ed25519 identity keys (idempotent)
// ---------------------------------------------------------------------------

const identityDir = join(home, '.agentxp', 'identity')
const keyPath = join(identityDir, 'operator.key')
const pubPath = join(identityDir, 'operator.pub')

if (existsSync(keyPath) && existsSync(pubPath)) {
  const pub = readFileSync(pubPath, 'utf8').trim()
  console.log(`  ✓ identity keys exist (pubkey: ${pub.slice(0, 16)}...)`)
} else {
  try {
    // Use Node.js built-in crypto — no external dependency needed
    const { generateKeyPairSync } = await import('crypto')
    mkdirSync(identityDir, { recursive: true })

    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    })

    // Ed25519 DER: public key raw bytes are last 32 bytes of SPKI
    const pubRaw = publicKey.subarray(publicKey.length - 32)
    // Ed25519 DER: private key seed is last 32 bytes of PKCS8
    const privRaw = privateKey.subarray(privateKey.length - 32)

    const toHex = (buf) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
    writeFileSync(keyPath, toHex(privRaw) + '\n')
    writeFileSync(pubPath, toHex(pubRaw) + '\n')
    try { chmodSync(keyPath, 0o600); chmodSync(pubPath, 0o600) } catch {}
    console.log(`  ✓ identity keys generated (pubkey: ${toHex(pubRaw).slice(0, 16)}...)`)
  } catch (err) {
    console.log(`  ✗ could not generate identity keys: ${err.message}`)
    console.log(`    Fix: run 'node scripts/post-install.mjs' from the agentxp directory`)
  }
}

// ---------------------------------------------------------------------------
// 6. Add reflection/ to .gitignore
// ---------------------------------------------------------------------------

const gitignorePath = join(workspace, '.gitignore')
if (existsSync(gitignorePath)) {
  const gitignore = readFileSync(gitignorePath, 'utf8')
  if (!gitignore.includes('reflection/')) {
    writeFileSync(gitignorePath, gitignore.trimEnd() + '\nreflection/\n')
  }
}

// ---------------------------------------------------------------------------
// 7. Run diagnosis scan (inline JS — no dist/ required, best-effort)
// ---------------------------------------------------------------------------

;(function runDiagnosisScan() {
  // ---------------------------------------------------------------------------
  // Pattern definitions (mirrored from src/diagnose.ts)
  // ---------------------------------------------------------------------------

  // Files to skip during scanning
  const EXCLUDE_FILENAME_PATTERNS = [
    /PHILOSOPHY/i, /RULES/i, /SPEC/i, /\bspec\b/i, /design/i, /plan/i, /^insight-/i,
  ]

  function shouldExcludeFile(filename) {
    return EXCLUDE_FILENAME_PATTERNS.some(p => p.test(filename))
  }

  const PATTERN_DEFS = [
    {
      id: 'unverified',
      title: 'Acting on Unverified Assumptions',
      reflection: 'verify before acting',
      subPatterns: [
        {
          id: '1a',
          description: 'answered without checking data ({count} times)',
          keywords: [
            /without checking/i, /without verifying/i,
            /didn[\u2019']t verify/i, /didn[\u2019']t check/i,
            /没验证/, /不验证/, /没确认/,
          ],
          requiresErrorContext: true,
        },
        {
          id: '1b',
          description: 'fabricated outputs instead of running tools ({count} times)',
          keywords: [
            /\bfabricat/i, /\bmade up\b/i,
            /虚构/, /编造/, /叙述替代/, /没有工具调用/,
          ],
          requiresErrorContext: false,
        },
        {
          id: '1c',
          description: 'assumed infrastructure details that turned out wrong ({count} times)',
          keywords: [
            /wrong port/i, /wrong path/i, /wrong endpoint/i,
            /wrong file/i, /wrong url/i, /wrong schema/i,
            /以为.*端口/, /以为.*路径/, /假设.*错/, /错误端口/, /端口错配/,
          ],
          requiresErrorContext: false,
        },
      ],
    },
    {
      id: 'incomplete',
      title: 'Marking Work Done Before Complete',
      reflection: 'end-to-end verify before marking done',
      subPatterns: [
        {
          id: '2a',
          description: 'only completed partial changes ({count} times)',
          keywords: [
            /only half/i, /half done/i,
            /只移了/, /只做了一半/, /只改了/,
          ],
          requiresErrorContext: true,
        },
        {
          id: '2b',
          description: 'wrote code but never wired it up ({count} times)',
          keywords: [
            /wrote code but/i, /tests pass but/i, /implemented but/i,
            /写了但没/, /接了一半/, /代码.*但.*没挂/, /写了.*但.*没接/,
          ],
          requiresErrorContext: false,
        },
        {
          id: '2c',
          description: 'forgot to sync or update related files ({count} times)',
          keywords: [
            /not synced/i, /out of sync/i, /didn[\u2019']t update/i,
            /没同步/, /不同步/, /遗漏/, /没更新/, /忘了更新/,
          ],
          requiresErrorContext: true,
        },
        {
          id: '2d',
          description: 'overlooked items during review ({count} times)',
          keywords: [
            /\boverlooked\b/i, /\bleft out\b/i, /\bmissed\b/i, /脱节/,
          ],
          requiresErrorContext: true,
        },
      ],
    },
    {
      id: 'symptom-fix',
      title: 'Fixing Symptoms Instead of Root Causes',
      reflection: 'after fixing a bug, search all similar locations',
      subPatterns: [
        {
          id: '3a',
          description: 'fixed the same type of bug multiple times ({count} times)',
          keywords: [
            /same bug/i, /same error/i, /same issue/i,
            /同类.*bug/i, /同一天.*次/, /第.{0,3}次修/, /又一次/,
          ],
          requiresErrorContext: false,
        },
        {
          id: '3b',
          description: 'encountered recurring issues without root cause analysis ({count} times)',
          keywords: [
            /\brecurring\b/i, /\brepeated\b/i, /重复/, /\bagain\b/i,
          ],
          requiresErrorContext: true,
          excludeKeywords: [
            /root cause/i, /underlying/i, /systematic/i,
          ],
        },
      ],
    },
  ]

  const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  const ERROR_MARKERS = /\[!\]|错|error|fail|bug|fix|wrong|修复|问题|broke|crash/i

  // Check if a line has error context within ±2 lines
  function hasErrorContext(lines, lineIndex) {
    const start = Math.max(0, lineIndex - 2)
    const end = Math.min(lines.length - 1, lineIndex + 2)
    for (let i = start; i <= end; i++) {
      if (ERROR_MARKERS.test(lines[i])) return true
    }
    return false
  }

  // Collect candidate files
  function collectFiles(workspaceDir) {
    const candidates = []
    const memoryDir = join(workspaceDir, 'memory')
    if (existsSync(memoryDir)) {
      try {
        for (const entry of readdirSync(memoryDir)) {
          if (entry.endsWith('.md') && !shouldExcludeFile(entry)) {
            candidates.push(join(memoryDir, entry))
          }
        }
      } catch {}
    }
    const topMemory = join(workspaceDir, 'MEMORY.md')
    if (existsSync(topMemory)) candidates.push(topMemory)
    const hermesMemory = join(workspaceDir, '.hermes', 'memories', 'MEMORY.md')
    if (existsSync(hermesMemory)) candidates.push(hermesMemory)
    const mistakesFile = join(workspaceDir, 'reflection', 'mistakes.md')
    if (existsSync(mistakesFile)) candidates.push(mistakesFile)
    return [...new Set(candidates)]
  }

  // Infer days span from file-name dates
  function inferDaysSpan(filePaths) {
    const dateRe = /(\d{4}-\d{2}-\d{2})/
    const timestamps = []
    for (const p of filePaths) {
      const name = p.split('/').pop() || ''
      const m = dateRe.exec(name)
      if (m) {
        const ts = Date.parse(m[1])
        if (!isNaN(ts)) timestamps.push(ts)
      }
    }
    if (timestamps.length < 2) return timestamps.length === 0 ? 0 : 1
    const min = Math.min(...timestamps)
    const max = Math.max(...timestamps)
    return Math.round((max - min) / (1000 * 60 * 60 * 24)) + 1
  }

  // Match a single sub-pattern against lines
  function matchSubPattern(subDef, lines) {
    let count = 0
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (!trimmed) continue
      let matched = false
      for (const kw of subDef.keywords) {
        if (kw.test(trimmed)) { matched = true; break }
      }
      if (!matched) continue
      if (subDef.excludeKeywords) {
        let excluded = false
        for (const exkw of subDef.excludeKeywords) {
          if (exkw.test(trimmed)) { excluded = true; break }
        }
        if (excluded) continue
      }
      if (subDef.requiresErrorContext && !hasErrorContext(lines, i)) continue
      count++
    }
    return count
  }

  // Run the full scan
  function runDiagnose(workspaceDir) {
    const filePaths = collectFiles(workspaceDir)
    if (filePaths.length === 0) return { filesScanned: 0, daysSpan: 0, totalErrorEvents: 0, patterns: [] }

    const allLines = []
    for (const fp of filePaths) {
      try { allLines.push(...readFileSync(fp, 'utf8').split('\n')) } catch {}
    }

    const daysSpan = inferDaysSpan(filePaths)
    const patterns = []
    let totalErrorEvents = 0

    for (const def of PATTERN_DEFS) {
      const subPatterns = []
      let patternTotal = 0
      for (const subDef of def.subPatterns) {
        const count = matchSubPattern(subDef, allLines)
        subPatterns.push({ id: subDef.id, description: subDef.description, count })
        patternTotal += count
      }
      totalErrorEvents += patternTotal
      if (patternTotal >= 2) {
        patterns.push({ id: def.id, title: def.title, count: patternTotal, subPatterns, reflection: def.reflection })
      }
    }
    patterns.sort((a, b) => b.count - a.count)
    return { filesScanned: filePaths.length, daysSpan, totalErrorEvents, patterns }
  }

  // Build narrative sentence from active sub-patterns
  function buildNarrative(subPatterns) {
    const active = subPatterns
      .filter(sp => sp.count > 0)
      .map(sp => sp.description.replace('{count}', String(sp.count)))
    if (active.length === 0) return ''
    if (active.length === 1) return `  Your agent ${active[0]}.`
    const allButLast = active.slice(0, -1)
    const last = active[active.length - 1]
    return `  Your agent ${allButLast.join(',\n  ')},\n  and ${last}.`
  }

  // Format the report for the terminal
  function formatReport(report) {
    const lines = ['']
    lines.push(RULE)
    lines.push('')
    lines.push('  🧠 AgentXP Diagnosis Report')
    lines.push('')

    if (report.filesScanned === 0 || report.patterns.length === 0) {
      lines.push('  No agent memory found — starting fresh.')
      lines.push('  Your agent will build error patterns as it works.')
      lines.push('  After the first few tasks, run `agentxp diagnose` to see what it learned.')
      lines.push('')
      lines.push(RULE)
      return lines.join('\n')
    }

    lines.push(`  Scanned: ${report.filesScanned} files across ${report.daysSpan} days`)
    const pl = report.patterns.length !== 1 ? 'patterns' : 'pattern'
    lines.push(`  Found: ${report.patterns.length} recurring ${pl}`)
    lines.push('')
    lines.push(RULE)

    for (let i = 0; i < report.patterns.length; i++) {
      const p = report.patterns[i]
      lines.push('')
      lines.push(`  #${i + 1} ${p.title} (${p.count} times)`)
      lines.push('')
      const narrative = buildNarrative(p.subPatterns)
      if (narrative) lines.push(narrative)
      lines.push('')
      lines.push(`  ✅ Added rule: ${p.reflection}`)
      lines.push('')
      lines.push(RULE)
    }

    lines.push('')
    lines.push('  These patterns are now in your agent\'s memory.')
    lines.push('  They won\'t disappear completely, but based on testing,')
    lines.push('  repeat errors drop by ~80%.')
    lines.push('')
    lines.push('  → reflection/mistakes.md')
    lines.push('')
    lines.push(RULE)
    return lines.join('\n')
  }

  // Write to reflection/mistakes.md (append only)
  function writeToMistakes(report, reflectionDir) {
    if (report.patterns.length === 0) return
    mkdirSync(reflectionDir, { recursive: true })
    const mistakesPath = join(reflectionDir, 'mistakes.md')
    const date = new Date().toISOString().slice(0, 10)
    const parts = ['']
    for (const p of report.patterns) {
      parts.push(`## ${date} ${p.title} (auto-detected by AgentXP)`)
      parts.push(`- Pattern: ${p.title}`)
      parts.push(`- Frequency: ${p.count} times in ${report.daysSpan} days`)
      parts.push(`- Rule: ${p.reflection}`)
      parts.push('- Tags: auto-detected, install-scan')
      parts.push('')
    }
    const existing = existsSync(mistakesPath) ? readFileSync(mistakesPath, 'utf8') : ''
    writeFileSync(mistakesPath, existing + parts.join('\n'), 'utf8')
  }

  try {
    const report = runDiagnose(workspace)
    console.log(formatReport(report))
    if (report.patterns.length > 0) {
      writeToMistakes(report, reflectionDir)
    }
  } catch {
    // Diagnosis is best-effort, never block installation
  }
})()

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log('')
console.log('AgentXP installed! Your agent will now:')
console.log('  • Reflect after every task (mistakes, lessons, feelings, thoughts)')
console.log('  • Search the network for relevant experiences before starting work')
console.log('  • Publish verified experiences to help other agents')
console.log('')
console.log('No further configuration needed. Just start working.')
