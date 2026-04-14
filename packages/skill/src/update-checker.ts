// Update Checker — heartbeat-friendly version check against relay
// Three modes: notify (default), auto, off
// Checks at most once per 24 hours to avoid hammering the relay.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export type UpdateMode = 'notify' | 'auto' | 'off'

export interface UpdateCheckResult {
  /** Whether an update is available */
  updateAvailable: boolean
  /** Current local version */
  currentVersion: string
  /** Latest version from relay (null if check skipped or failed) */
  latestVersion: string | null
  /** Minimum compatible version */
  minCompatible: string | null
  /** Changelog URL */
  changelogUrl: string | null
  /** Human-readable message */
  message: string
  /** Whether the check was skipped (cooldown or disabled) */
  skipped: boolean
}

const CHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours
const CURRENT_VERSION = '4.1.0'

/**
 * Read the last check timestamp from ~/.agentxp/update-check.json
 */
function readLastCheck(homeDir?: string): number {
  const home = homeDir || homedir()
  const checkFile = join(home, '.agentxp', 'update-check.json')
  if (!existsSync(checkFile)) return 0
  try {
    const data = JSON.parse(readFileSync(checkFile, 'utf8'))
    return data.lastCheckMs || 0
  } catch {
    return 0
  }
}

/**
 * Write the last check timestamp
 */
function writeLastCheck(homeDir?: string): void {
  const home = homeDir || homedir()
  const dir = join(home, '.agentxp')
  mkdirSync(dir, { recursive: true })
  const checkFile = join(dir, 'update-check.json')
  writeFileSync(checkFile, JSON.stringify({ lastCheckMs: Date.now() }))
}

/**
 * Compare two semver strings. Returns:
 *  1 if a > b, -1 if a < b, 0 if equal
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

/**
 * Check for updates against the relay's /api/v1/version endpoint.
 * Respects 24-hour cooldown to avoid excessive requests.
 *
 * @param relayUrl - Relay base URL (wss:// or https://)
 * @param mode - Update mode: notify, auto, or off
 * @param homeDir - Override home directory (for testing)
 */
export async function checkForUpdate(
  relayUrl: string,
  mode: UpdateMode = 'notify',
  homeDir?: string,
): Promise<UpdateCheckResult> {
  if (mode === 'off') {
    return {
      updateAvailable: false,
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      minCompatible: null,
      changelogUrl: null,
      message: 'Update checking disabled.',
      skipped: true,
    }
  }

  // Cooldown check
  const lastCheck = readLastCheck(homeDir)
  if (Date.now() - lastCheck < CHECK_COOLDOWN_MS) {
    return {
      updateAvailable: false,
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      minCompatible: null,
      changelogUrl: null,
      message: 'Skipped — checked recently.',
      skipped: true,
    }
  }

  // Query relay
  const httpUrl = relayUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '')

  try {
    const res = await fetch(`${httpUrl}/api/v1/version`, {
      signal: AbortSignal.timeout(5_000),
    })

    if (!res.ok) {
      return {
        updateAvailable: false,
        currentVersion: CURRENT_VERSION,
        latestVersion: null,
        minCompatible: null,
        changelogUrl: null,
        message: `Version check failed: HTTP ${res.status}`,
        skipped: false,
      }
    }

    const data = await res.json() as {
      latest_version: string
      min_compatible?: string
      changelog_url?: string
    }

    writeLastCheck(homeDir)

    const latest = data.latest_version
    const hasUpdate = compareSemver(latest, CURRENT_VERSION) > 0

    if (!hasUpdate) {
      return {
        updateAvailable: false,
        currentVersion: CURRENT_VERSION,
        latestVersion: latest,
        minCompatible: data.min_compatible ?? null,
        changelogUrl: data.changelog_url ?? null,
        message: `AgentXP ${CURRENT_VERSION} is up to date.`,
        skipped: false,
      }
    }

    return {
      updateAvailable: true,
      currentVersion: CURRENT_VERSION,
      latestVersion: latest,
      minCompatible: data.min_compatible ?? null,
      changelogUrl: data.changelog_url ?? null,
      message: `AgentXP update available: ${CURRENT_VERSION} → ${latest}. ${data.changelog_url ? `Changelog: ${data.changelog_url}` : ''}`,
      skipped: false,
    }
  } catch (err) {
    return {
      updateAvailable: false,
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      minCompatible: null,
      changelogUrl: null,
      message: `Version check failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      skipped: false,
    }
  }
}
