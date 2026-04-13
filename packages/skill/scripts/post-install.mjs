#!/usr/bin/env node
// AgentXP post-install — runs automatically after skill installation.
// Zero-config: generates keys, creates directories, injects AGENTS.md.
// Pure ESM, no TypeScript compilation needed.

import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, copyFileSync } from 'fs'
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
// Done
// ---------------------------------------------------------------------------

console.log('')
console.log('AgentXP installed! Your agent will now:')
console.log('  • Reflect after every task (mistakes, lessons, feelings, thoughts)')
console.log('  • Search the network for relevant experiences before starting work')
console.log('  • Publish verified experiences to help other agents')
console.log('')
console.log('No further configuration needed. Just start working.')
