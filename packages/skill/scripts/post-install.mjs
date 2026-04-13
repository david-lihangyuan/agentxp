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
  // Walk up from skill directory looking for AGENTS.md or .openclaw marker
  let dir = join(__dirname, '..')
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'AGENTS.md')) || existsSync(join(dir, '.openclaw'))) {
      return dir
    }
    // Check if parent has skills/ directory (we're inside skills/agentxp/)
    const parent = join(dir, '..')
    const grandparent = join(parent, '..')
    if (existsSync(join(grandparent, 'AGENTS.md'))) {
      return grandparent
    }
    dir = parent
  }
  // Fallback: use OpenClaw workspace from env
  return process.env.OPENCLAW_WORKSPACE || process.env.HOME || homedir()
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
    // Try to import protocol for key generation
    const protocol = await import('@serendip/protocol')
    mkdirSync(identityDir, { recursive: true })
    const key = await protocol.generateOperatorKey()
    const hexKey = Array.from(key.privateKey).map(b => b.toString(16).padStart(2, '0')).join('')
    writeFileSync(keyPath, hexKey + '\n')
    writeFileSync(pubPath, key.publicKey + '\n')
    try { chmodSync(keyPath, 0o600); chmodSync(pubPath, 0o600) } catch {}
    console.log(`  ✓ identity keys generated (pubkey: ${key.publicKey.slice(0, 16)}...)`)
  } catch (err) {
    console.log(`  ⚠ could not generate identity keys (${err.message}). Run 'agentxp install' manually.`)
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
