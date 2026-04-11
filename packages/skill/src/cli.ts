#!/usr/bin/env node
// AgentXP CLI — lightweight command interface
// Commands: status, dashboard, config, update, install

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface StatusResult {
  agent_name: string
  relay_connected: boolean
  identity_exists: boolean
  reflection_dir_exists: boolean
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

// CLI entry point when run directly
const args = process.argv.slice(2)
const command = args[0]

if (command === 'status') {
  const isJson = args.includes('--json')
  const status = getStatus()
  if (isJson) {
    process.stdout.write(JSON.stringify(status, null, 2) + '\n')
  } else {
    console.log(`Agent: ${status.agent_name}`)
    console.log(`Identity: ${status.identity_exists ? '✓' : '✗'}`)
    console.log(`Reflection: ${status.reflection_dir_exists ? '✓' : '✗'}`)
    console.log(`Relay: ${status.relay_connected ? 'connected' : 'disconnected'}`)
  }
} else if (command === 'install') {
  import('./install.js').then(async ({ runInstall }) => {
    await runInstall({ workspaceDir: process.cwd() })
    console.log('✓ AgentXP installed successfully.')
  })
} else if (command === undefined || command === 'help') {
  console.log('Usage: agentxp <command>')
  console.log('')
  console.log('Commands:')
  console.log('  status     Show installation status')
  console.log('  install    Install AgentXP in current workspace')
  console.log('  help       Show this help message')
}
