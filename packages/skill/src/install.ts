// AgentXP Install Script — Zero-configuration setup
// Creates reflection directories, generates identity keys, configures workspace.

import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { hostname } from 'os'
import { generateOperatorKey } from '@serendip/protocol'
import { bytesToHex } from './utils.js'

export interface InstallOptions {
  /** Workspace directory (where AGENTS.md lives or will live) */
  workspaceDir: string
  /** Home directory override for key storage (default: os.homedir()) */
  homeDir?: string
  /** Skip CLI symlink creation (useful in tests) */
  skipCliSymlink?: boolean
}

/**
 * Simple YAML serialization for config (no external dependency needed).
 * Only supports flat key-value pairs with string values.
 */
function toYaml(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([key, val]) => `${key}: ${val}`)
    .join('\n') + '\n'
}

/** Header and content block appended to AGENTS.md */
const AGENTS_BLOCK = `
## AgentXP Skill

After every task, pause and reflect. Write to reflection/ files.
Before starting a task, check mistakes.md and lessons.md for relevant past experience.
See skills/agentxp/SKILL.md for full instructions.
`

/**
 * Run the AgentXP install process.
 * Idempotent: safe to run multiple times.
 */
export async function runInstall(options: InstallOptions): Promise<void> {
  const { workspaceDir, homeDir, skipCliSymlink } = options
  const home = homeDir || process.env.HOME || process.env.USERPROFILE || '~'

  // 1. Create reflection directory structure
  const reflectionDir = join(workspaceDir, 'reflection')
  const reflectionFiles = ['mistakes.md', 'lessons.md', 'feelings.md', 'thoughts.md']

  mkdirSync(reflectionDir, { recursive: true })
  for (const file of reflectionFiles) {
    const filePath = join(reflectionDir, file)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, `# ${file.replace('.md', '').charAt(0).toUpperCase() + file.replace('.md', '').slice(1)}\n\n`)
    }
  }

  // 2. Create drafts/ and published/ directories
  mkdirSync(join(workspaceDir, 'drafts'), { recursive: true })
  mkdirSync(join(workspaceDir, 'published'), { recursive: true })

  // 3. Append to AGENTS.md (idempotent)
  const agentsPath = join(workspaceDir, 'AGENTS.md')
  if (existsSync(agentsPath)) {
    const existing = readFileSync(agentsPath, 'utf8')
    if (!existing.includes('AgentXP Skill')) {
      writeFileSync(agentsPath, existing.trimEnd() + '\n' + AGENTS_BLOCK)
    }
  } else {
    writeFileSync(agentsPath, '# Agent Configuration\n' + AGENTS_BLOCK)
  }

  // 4. Add reflection/ to .gitignore
  const gitignorePath = join(workspaceDir, '.gitignore')
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf8')
    if (!gitignore.includes('reflection/')) {
      writeFileSync(gitignorePath, gitignore.trimEnd() + '\nreflection/\n')
    }
  } else {
    writeFileSync(gitignorePath, 'reflection/\n')
  }

  // 5. Create config.yaml (3 human-readable fields only)
  const skillDir = join(workspaceDir, 'skills', 'agentxp')
  mkdirSync(skillDir, { recursive: true })

  const configPath = join(skillDir, 'config.yaml')
  if (!existsSync(configPath)) {
    const agentName = `agent-${hostname().toLowerCase()}`
    const config = toYaml({
      agent_name: agentName,
      relay_url: 'wss://relay.agentxp.io',
      visibility_default: 'public',
    })
    writeFileSync(configPath, config)
  }

  // 6. Generate identity keys (idempotent)
  await generateIdentityKeys(home)

  // 7. CLI symlink (optional)
  if (!skipCliSymlink) {
    createCliSymlink()
  }
}

/**
 * Generate Ed25519 identity keys to ~/.agentxp/identity/.
 * Idempotent: does NOT overwrite existing keys.
 */
export async function generateIdentityKeys(homeDir: string): Promise<void> {
  const identityDir = join(homeDir, '.agentxp', 'identity')
  mkdirSync(identityDir, { recursive: true })

  const keyPath = join(identityDir, 'operator.key')
  const pubPath = join(identityDir, 'operator.pub')

  if (existsSync(keyPath) && existsSync(pubPath)) {
    // Keys already exist — do not overwrite (idempotent)
    return
  }

  const operatorKey = await generateOperatorKey()
  writeFileSync(keyPath, bytesToHex(operatorKey.privateKey) + '\n')
  writeFileSync(pubPath, operatorKey.publicKey + '\n')

  // Set restrictive permissions (chmod 600)
  try {
    chmodSync(keyPath, 0o600)
    chmodSync(pubPath, 0o600)
  } catch {
    // chmod may fail on Windows — that's acceptable
  }
}

/**
 * Create the agentxp CLI symlink in a standard PATH location.
 */
function createCliSymlink(): void {
  const binDir = '/usr/local/bin'
  const symlinkPath = join(binDir, 'agentxp')
  const cliScript = resolve(__dirname, 'cli.ts')

  try {
    if (existsSync(symlinkPath)) {
      unlinkSync(symlinkPath)
    }
    symlinkSync(cliScript, symlinkPath)
  } catch {
    // May fail without sudo — acceptable; user can add to PATH manually
  }
}
