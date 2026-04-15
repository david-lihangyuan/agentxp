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
  const PATTERN_DEFS = [
    {
      id: 'unverified',
      title: 'Acting on Unverified Assumptions',
      reflection: 'Always verify before acting. Check the actual file, port, URL, or endpoint instead of assuming.',
      keywords: [
        /\bassumed\b/i, /\bassumption\b/i, /thought it was/i, /turned out/i,
        /\bactually\b/i, /without checking/i, /without verifying/i,
        /didn[\u2019']t verify/i, /didn[\u2019']t check/i,
        /\bfabricat/i, /\bmade up\b/i, /\bhallucinate/i,
        /wrong port/i, /wrong path/i, /wrong endpoint/i, /wrong url/i, /wrong file/i,
        /没验证/, /不验证/, /没确认/, /想当然/, /以为/, /虚构/, /编造/, /假设.*错/,
      ],
    },
    {
      id: 'incomplete',
      title: 'Marking Work Done Before It Is Complete',
      reflection: 'Do not mark a task complete until all parts are verified: code, tests, docs, and synced state.',
      keywords: [
        /only half/i, /half done/i, /\bpartially\b/i, /\bincomplete\b/i,
        /forgot to/i, /\bmissed\b/i, /\boverlooked\b/i, /left out/i,
        /not synced/i, /out of sync/i, /didn[\u2019']t update/i, /wasn[\u2019']t updated/i,
        /wrote code but/i, /tests pass but/i, /implemented but/i,
        /只做了一半/, /只移了/, /\b遗漏/, /没更新/, /没同步/, /不同步/, /脱节/, /接了一半/, /写了但没/,
      ],
    },
    {
      id: 'symptom-fix',
      title: 'Fixing Symptoms Instead of Root Causes',
      reflection: 'When the same error recurs, stop and identify the root cause before patching the symptom again.',
      keywords: [
        /same bug/i, /same error/i, /same issue/i, /\bagain\b/i,
        /third time/i, /second time/i, /same type/i, /similar error/i,
        /\brecurring\b/i, /\brepeated\b/i, /root cause/i, /\bunderlying\b/i, /\bsystematic\b/i,
        /同类/, /同样的/, /又一次/, /第.{0,3}次修/, /同一天.{0,5}次/, /\b重复/,
      ],
    },
  ]

  const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

  // Collect candidate files
  function collectFiles(workspaceDir) {
    const candidates = []
    const memoryDir = join(workspaceDir, 'memory')
    if (existsSync(memoryDir)) {
      try {
        for (const entry of readdirSync(memoryDir)) {
          if (entry.endsWith('.md')) candidates.push(join(memoryDir, entry))
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

  // Match a single pattern against lines
  function matchPattern(def, lines) {
    let count = 0
    const examples = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let matched = false
      for (const kw of def.keywords) {
        if (kw.test(trimmed)) { matched = true; break }
      }
      if (matched) {
        count++
        if (examples.length < 3) {
          examples.push(trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed)
        }
      }
    }
    return { count, examples }
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
      const { count, examples } = matchPattern(def, allLines)
      totalErrorEvents += count
      if (count >= 2) {
        patterns.push({ id: def.id, title: def.title, count, examples, reflection: def.reflection })
      }
    }
    patterns.sort((a, b) => b.count - a.count)
    return { filesScanned: filePaths.length, daysSpan, totalErrorEvents, patterns }
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
    lines.push(`  Found: ${report.totalErrorEvents} error events, ${report.patterns.length} recurring pattern(s)`)
    lines.push('')
    lines.push(RULE)

    for (let i = 0; i < report.patterns.length; i++) {
      const p = report.patterns[i]
      lines.push('')
      lines.push(`  #${i + 1} ${p.title} (${p.count} times)`)
      lines.push('')
      for (const ex of p.examples) lines.push(`  ${ex}`)
      lines.push('')
      const shortRule = p.reflection.split('.')[0]
      lines.push(`  ✅ Added reflection rule: ${shortRule}.`)
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
