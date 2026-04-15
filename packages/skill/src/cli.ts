#!/usr/bin/env node
// AgentXP CLI — lightweight command interface
// Commands: status, dashboard, config, update, install

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface StatusResult {
  agent_name: string
  relay_connected: boolean
  identity_exists: boolean
  reflection_dir_exists: boolean
}

export interface ConfigResult {
  workspace: string
  config_path: string
  values: Record<string, string>
}

export interface DashboardResult {
  url: string | null
  relay_url: string | null
  operator_key: string | null
  message: string
  error?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect the AgentXP workspace root.
 *
 * Searches upward from startDir for a directory containing
 * skills/agentxp/config.yaml. Falls back to startDir itself.
 * Returns null if startDir does not exist.
 */
/**
 * Check if a directory looks like an actual workspace (not just any dir with AGENTS.md).
 * Requires AGENTS.md or .openclaw marker PLUS at least one workspace-specific item.
 */
function looksLikeWorkspace(dir: string): boolean {
  const hasMarker = existsSync(join(dir, 'AGENTS.md')) || existsSync(join(dir, '.openclaw'))
  if (!hasMarker) return false
  // Must also have at least one workspace-specific file/dir
  return existsSync(join(dir, 'SOUL.md')) ||
    existsSync(join(dir, 'memory')) ||
    existsSync(join(dir, 'reflection')) ||
    existsSync(join(dir, 'MEMORY.md')) ||
    existsSync(join(dir, 'HEARTBEAT.md'))
}

export function findWorkspace(startDir?: string): string | null {
  const start = startDir || process.cwd()
  if (!existsSync(start)) {
    return null
  }

  // Strategy 0: explicit env var (most reliable, no guessing)
  if (process.env.OPENCLAW_WORKSPACE && existsSync(process.env.OPENCLAW_WORKSPACE)) {
    return process.env.OPENCLAW_WORKSPACE
  }

  // Strategy 1: Walk up looking for a real workspace (stop at home dir — never treat ~ as workspace)
  const home = homedir()
  let dir = start
  for (let i = 0; i < 10; i++) {
    // Stop: never treat home directory as a workspace
    if (dir === home) break
    if (looksLikeWorkspace(dir)) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Strategy 2: Walk up looking for skills/agentxp/config.yaml (ClawHub installs)
  dir = start
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'skills', 'agentxp', 'config.yaml'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Strategy 3: Walk up from script location (npm global installs)
  dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    if (dir === home) break
    if (looksLikeWorkspace(dir)) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Strategy 4: OpenClaw default workspace (single agent)
  const openclawDefault = join(homedir(), '.openclaw', 'workspace')
  if (existsSync(openclawDefault)) {
    return openclawDefault
  }

  // Strategy 5: OpenClaw multi-agent workspaces (workspace-*)
  const openclawDir = join(homedir(), '.openclaw')
  if (existsSync(openclawDir)) {
    try {
      const entries = readdirSync(openclawDir)
      for (const entry of entries) {
        if (entry.startsWith('workspace-') || entry === 'workspace') {
          const candidate = join(openclawDir, entry)
          if (looksLikeWorkspace(candidate)) {
            return candidate
          }
        }
      }
    } catch {}
  }

  // Fallback: cwd
  return start
}

/**
 * Read config.yaml from the current workspace skills directory.
 */
function readConfig(workspaceDir: string): Record<string, string> {
  const configPath = join(workspaceDir, 'skills', 'agentxp', 'config.yaml')
  if (!existsSync(configPath)) {
    return {}
  }
  const content = readFileSync(configPath, 'utf8')
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/)
    if (match) {
      result[match[1]] = match[2].trim()
    }
  }
  return result
}

/**
 * Write a key=value pair to config.yaml.
 */
function writeConfigValue(workspaceDir: string, key: string, value: string): void {
  const configPath = join(workspaceDir, 'skills', 'agentxp', 'config.yaml')
  let content = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  const lines = content.split('\n')
  const idx = lines.findIndex((l) => l.startsWith(`${key}:`))
  const newLine = `${key}: ${value}`
  if (idx >= 0) {
    lines[idx] = newLine
  } else {
    lines.push(newLine)
  }
  writeFileSync(configPath, lines.filter((l) => l !== '').join('\n') + '\n', 'utf8')
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Get status information about the current AgentXP installation.
 */
export function getStatus(workspaceDir?: string, homeDir?: string): StatusResult {
  const workspace = workspaceDir || process.cwd()
  const home = homeDir || homedir()
  const config = readConfig(workspace)

  return {
    agent_name: config.agent_name || 'unknown',
    relay_connected: false, // Would need actual relay ping in production
    identity_exists: existsSync(join(home, '.agentxp', 'identity', 'operator.pub')),
    reflection_dir_exists: existsSync(join(workspace, 'reflection')),
  }
}

/**
 * Get dashboard URL and relay info.
 */
export function getDashboard(workspaceDir?: string): DashboardResult {
  const workspace = workspaceDir || process.cwd()

  if (!existsSync(workspace)) {
    return {
      url: null,
      relay_url: null,
      operator_key: null,
      message: workspaceNotFoundMessage(workspace),
    }
  }

  const config = readConfig(workspace)
  const relayUrl = config.relay_url || null
  const operatorKey = config.operator_key || null

  if (!relayUrl) {
    return {
      url: null,
      relay_url: null,
      operator_key: operatorKey,
      message:
        'No relay_url configured. Run `agentxp config relay_url <url>` to set your relay URL, then open `<relay_url>/dashboard`.',
    }
  }

  const dashboardUrl = `${relayUrl.replace(/\/$/, '')}/dashboard`
  return {
    url: dashboardUrl,
    relay_url: relayUrl,
    operator_key: operatorKey,
    message: `Dashboard available at: ${dashboardUrl}`,
  }
}

/**
 * Get or set config values.
 *
 * @param key    - Config key to get/set. If undefined, lists all values.
 * @param value  - New value (if setting). If undefined, reads current value.
 */
export function runConfig(
  workspaceDir?: string,
  key?: string,
  value?: string
): ConfigResult & { error?: string } {
  const workspace = workspaceDir || process.cwd()
  const configPath = join(workspace, 'skills', 'agentxp', 'config.yaml')

  if (!existsSync(workspace)) {
    return {
      workspace,
      config_path: configPath,
      values: {},
      error: workspaceNotFoundMessage(workspace),
    }
  }

  if (key && value !== undefined) {
    writeConfigValue(workspace, key, value)
  }

  const values = readConfig(workspace)
  return { workspace, config_path: configPath, values }
}

/**
 * Check for and apply updates to the AgentXP skill.
 */
export async function runUpdate(workspaceDir?: string): Promise<{
  current_version: string
  latest_version: string | null
  updated: boolean
  message: string
  error?: string
}> {
  const workspace = workspaceDir || process.cwd()

  if (!existsSync(workspace)) {
    return {
      current_version: 'unknown',
      latest_version: null,
      updated: false,
      message: workspaceNotFoundMessage(workspace),
      error: 'workspace not found',
    }
  }

  // Read current version from package.json (resolved relative to this file at runtime)
  let currentVersion = 'unknown'
  try {
    // __dirname is defined via fileURLToPath at top of file
    const pkgPath = join(__dirname, '..', 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      currentVersion = pkg.version || 'unknown'
    }
  } catch {
    // ignore
  }

  // Check npm registry for latest version
  let latestVersion: string | null = null
  try {
    const { execSync } = await import('child_process')
    const result = execSync('npm view @agentxp/skill version', { encoding: 'utf8', timeout: 10000 })
    latestVersion = result.trim()
  } catch {
    return {
      current_version: currentVersion,
      latest_version: null,
      updated: false,
      message: 'Could not check for updates (network unavailable or npm not configured).',
    }
  }

  if (latestVersion === currentVersion) {
    return {
      current_version: currentVersion,
      latest_version: latestVersion,
      updated: false,
      message: `Already on latest version: ${currentVersion}`,
    }
  }

  return {
    current_version: currentVersion,
    latest_version: latestVersion,
    updated: false,
    message: `Update available: ${currentVersion} → ${latestVersion}.\nRun: npm install -g @agentxp/skill@${latestVersion}`,
  }
}

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

/**
 * Return a helpful, human-readable error message when the workspace is not found.
 * This is intentionally user-friendly — not a stack trace.
 */
export function workspaceNotFoundMessage(dir: string): string {
  return [
    '',
    '  ✗  AgentXP workspace not found.',
    '',
    `     Searched: ${dir}`,
    '',
    '     To fix this, either:',
    '       1. Run this command from your workspace directory.',
    '       2. Run `agentxp install` to set up AgentXP in the current directory.',
    '',
    '     Need help? See: https://agentxp.dev/docs/getting-started',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const command = args[0]

function printHelp(): void {
  console.log('Usage: agentxp <command> [options]')
  console.log('')
  console.log('Commands:')
  console.log('  status              Show installation status')
  console.log('  publish             Scan reflections, create drafts, publish to relay')
  console.log('  dashboard           Open or print the dashboard URL')
  console.log('  config [key] [val]  Get or set config values')
  console.log('  update              Check for and apply updates')
  console.log('  install             Install AgentXP in current workspace')
  console.log('  diagnose            Scan memory files for recurring error patterns')
  console.log('  distill             Auto-extract strategy rules from accumulated mistakes')
  console.log('  help, --help        Show this help message')
  console.log('')
  console.log('Options:')
  console.log('  --json              Output as JSON (status command)')
  console.log('  --workspace <dir>   Use a specific workspace directory')
  console.log('  --dry-run           Simulate publish without network (publish command)')
  console.log('')
  console.log('Examples:')
  console.log('  agentxp status')
  console.log('  agentxp publish')
  console.log('  agentxp publish --dry-run')
  console.log('  agentxp dashboard')
  console.log('  agentxp config relay_url https://relay.example.com')
  console.log('  agentxp update')
}

// Parse --workspace flag
const workspaceFlagIdx = args.indexOf('--workspace')
const workspaceOverride =
  workspaceFlagIdx >= 0 && args[workspaceFlagIdx + 1]
    ? args[workspaceFlagIdx + 1]
    : undefined

const workspace = workspaceOverride || findWorkspace() || process.cwd()

if (command === 'status') {
  const isJson = args.includes('--json')
  const status = getStatus(workspace)
  if (isJson) {
    process.stdout.write(JSON.stringify(status, null, 2) + '\n')
  } else {
    console.log(`Agent:      ${status.agent_name}`)
    console.log(`Identity:   ${status.identity_exists ? '✓' : '✗'}`)
    console.log(`Reflection: ${status.reflection_dir_exists ? '✓' : '✗'}`)
    console.log(`Relay:      ${status.relay_connected ? 'connected' : 'disconnected'}`)
  }
  // Check for updates
  const config = readConfig(workspace)
  const relayUrl = config.relay_url || 'wss://relay.agentxp.io'
  const updateMode = (config.update_mode || 'notify') as 'notify' | 'auto' | 'off'
  import('./update-checker.js').then(async ({ checkForUpdate }) => {
    const result = await checkForUpdate(relayUrl, updateMode)
    if (result.updateAvailable) {
      console.log(`\n⬆ ${result.message}`)
    } else if (!result.skipped && result.latestVersion) {
      console.log(`\n✓ ${result.message}`)
    }
  }).catch(() => { /* silent */ })

} else if (command === 'dashboard') {
  const result = getDashboard(workspace)
  if (result.error || !result.url) {
    console.error(result.message)
    process.exit(1)
  } else {
    console.log(result.message)
    // Try to open in browser on macOS/Linux
    try {
      const { execSync } = await import('child_process')
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
      execSync(`${opener} ${result.url}`, { stdio: 'ignore' })
    } catch {
      // Not fatal if browser open fails
    }
  }
} else if (command === 'config') {
  const key = args[1]
  const value = args[2]
  const result = runConfig(workspace, key, value)
  if (result.error) {
    console.error(result.error)
    process.exit(1)
  } else if (key && value !== undefined) {
    console.log(`✓ Set ${key} = ${value}`)
  } else if (key) {
    const val = result.values[key]
    if (val !== undefined) {
      console.log(`${key}: ${val}`)
    } else {
      console.log(`${key} is not set`)
    }
  } else {
    // List all config
    const entries = Object.entries(result.values)
    if (entries.length === 0) {
      console.log(`No config found at ${result.config_path}`)
      console.log('Run `agentxp install` to set up AgentXP.')
    } else {
      for (const [k, v] of entries) {
        console.log(`${k}: ${v}`)
      }
    }
  }
} else if (command === 'update') {
  runUpdate(workspace).then((result) => {
    if (result.error && result.error === 'workspace not found') {
      console.error(result.message)
      process.exit(1)
    } else {
      console.log(result.message)
      if (result.latest_version && result.latest_version !== result.current_version) {
        process.exit(0)
      }
    }
  })
} else if (command === 'publish') {
  // Publish command: scan reflections → parse → create drafts → publish to relay
  const isDryRun = args.includes('--dry-run')

  import('./reflection-parser.js')
    .then(async ({ processReflectionFile }) => {
      const { createDraft, runBatchPublish } = await import('./publisher.js')

      const reflectionDir = join(workspace, 'reflection')
      if (!existsSync(reflectionDir)) {
        console.error('No reflection/ directory found. Run `agentxp install` first.')
        process.exit(1)
      }

      // Read config for relay URL
      const config = readConfig(workspace)
      const relayUrl = config.relay_url || 'wss://relay.agentxp.io'

      // Step 1: Scan reflection files for new entries
      console.log('Scanning reflections...')
      const reflectionFiles = ['mistakes.md', 'lessons.md']
      let newDrafts = 0

      for (const file of reflectionFiles) {
        const filePath = join(reflectionDir, file)
        if (!existsSync(filePath)) continue

        const entries = await processReflectionFile(filePath, workspace)
        const publishable = entries.filter(e => e.publishable)

        for (const entry of publishable) {
          // Map outcome string to valid type
          let outcome: 'succeeded' | 'failed' | 'partial' | 'inconclusive' = 'succeeded'
          if (entry.outcome) {
            const lower = entry.outcome.toLowerCase()
            if (lower.includes('fail')) outcome = 'failed'
            else if (lower.includes('partial')) outcome = 'partial'
            else if (lower.includes('inconclusive')) outcome = 'inconclusive'
          }

          await createDraft({
            what: entry.title || 'Untitled reflection',
            tried: entry.tried || '',
            outcome,
            learned: entry.learned || '',
          }, workspace)
          newDrafts++
        }

        if (publishable.length > 0) {
          console.log(`  ${file}: ${publishable.length} publishable, ${entries.length - publishable.length} skipped`)
        }
      }

      if (newDrafts === 0) {
        // Still try to publish existing drafts
        const draftsDir = join(workspace, 'drafts')
        const existingDrafts = existsSync(draftsDir)
          ? (await import('fs')).readdirSync(draftsDir).filter((f: string) => f.endsWith('.json')).length
          : 0
        if (existingDrafts === 0) {
          console.log('No new reflections to publish.')
          return
        }
        console.log(`No new reflections, but ${existingDrafts} pending drafts found.`)
      } else {
        console.log(`Created ${newDrafts} new drafts.`)
      }

      // Step 2: Batch publish all drafts
      console.log('\nPublishing to relay...')
      const result = await runBatchPublish(workspace, {
        relayUrl,
        dryRun: isDryRun,
      })

      console.log('')
      console.log(`Published: ${result.published}`)
      console.log(`Failed:    ${result.failed}`)
      console.log(`Skipped:   ${result.skippedDuplicate} (duplicates)`)

      if (isDryRun) {
        console.log('\n(dry run — nothing was actually sent to the relay)')
      }
    })
    .catch((err) => {
      console.error('Publish failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
} else if (command === 'diagnose') {
  import('./diagnose.js')
    .then(async ({ diagnose: runDiagnose, writeDiagnosisToMistakes }) => {
      const { formatDiagnosis } = await import('./format-diagnosis.js')
      const report = runDiagnose(workspace)
      console.log(formatDiagnosis(report))
      if (report.patterns.length > 0) {
        writeDiagnosisToMistakes(report, join(workspace, 'reflection'))
      }
    })
    .catch((err) => {
      console.error('Diagnose failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
} else if (command === 'distill') {
  import('./distill.js')
    .then(async ({ distillExperiences }) => {
      const reflectionDir = join(workspace, 'reflection')
      const result = distillExperiences(reflectionDir)
      console.log(`Distillation complete:`)
      console.log(`  New rules:        ${result.newRules}`)
      console.log(`  Updated rules:    ${result.updatedRules}`)
      console.log(`  Total strategies: ${result.totalStrategies}`)
      if (result.newRules === 0 && result.updatedRules === 0) {
        console.log('  (No pattern has accumulated 5+ mistakes yet)')
      }
    })
    .catch((err) => {
      console.error('Distill failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
} else if (command === 'install') {
  import('./install.js')
    .then(async ({ runInstall }) => {
      await runInstall({ workspaceDir: workspace })
      console.log('\n✓ AgentXP installed successfully.')
      console.log('')
      console.log('Next steps:')
      console.log('  1. Check your identity:    agentxp status')
      console.log('  2. Open the dashboard:     agentxp dashboard')
      console.log('  3. Publish your first XP:  agentxp publish')
      console.log('')
      console.log('Your identity keys are at: ~/.agentxp/identity/')
      console.log('Relay:                     wss://relay.agentxp.io')
      console.log('')
    })
    .catch((err) => {
      console.error('Installation failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
} else if (command === undefined || command === 'help' || command === '--help') {
  printHelp()
} else {
  console.error(`Unknown command: ${command}`)
  console.error('')
  printHelp()
  process.exit(1)
}
