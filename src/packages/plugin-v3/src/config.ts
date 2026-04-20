// Plugin config resolver (M7 Batch 2.5). Reads the pluginConfig
// map that the OpenClaw host hands to register(api) and produces a
// validated, defaulted, path-expanded struct. The configSchema in
// openclaw.plugin.json is the source of truth; this module mirrors
// it in code so the host can still enforce the JSON-Schema layer
// while we fail fast on anything the schema would have accepted but
// our runtime cannot handle (e.g. unresolved ~/).
import { homedir } from 'node:os'

export type Visibility = 'public' | 'unlisted' | 'private'

export interface ResolvedPluginConfig {
  relayUrl: string
  operatorPublicKey: string
  agentKeyPath: string
  defaultVisibility: Visibility
  stagingDbPath: string
  autoFlushSteps: number
  autoFlushIdleMs: number
}

const DEFAULTS = {
  relayUrl: 'https://relay.agentxp.io',
  agentKeyPath: '~/.agentxp/identity/agent.key',
  defaultVisibility: 'unlisted' as Visibility,
  stagingDbPath: '~/.agentxp/plugin-v3/staging.db',
  autoFlushSteps: 20,
  autoFlushIdleMs: 120_000,
}

const HEX_64 = /^[0-9a-f]{64}$/

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return `${homedir()}${path.slice(1)}`
  return path
}

function requireString(
  raw: Record<string, unknown>,
  key: string,
  fallback?: string,
): string {
  const v = raw[key]
  if (typeof v === 'string') return v
  if (v === undefined) {
    if (fallback !== undefined) return fallback
    throw new Error(`agentxp plugin: missing required config field "${key}"`)
  }
  throw new Error(
    `agentxp plugin: config field "${key}" must be a string (got ${typeof v})`,
  )
}

export function resolvePluginConfig(
  raw: Record<string, unknown> | undefined,
): ResolvedPluginConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(
      'agentxp plugin: pluginConfig is missing. Populate the plugin settings ' +
        'in OpenClaw (operatorPublicKey is required).',
    )
  }

  const relayUrl = requireString(raw, 'relayUrl', DEFAULTS.relayUrl)
  const operatorPublicKeyRaw = requireString(raw, 'operatorPublicKey')
  const operatorPublicKey = operatorPublicKeyRaw.toLowerCase()
  if (!HEX_64.test(operatorPublicKey)) {
    throw new Error(
      'agentxp plugin: operatorPublicKey must be a 64-character hex string ' +
        '(32-byte Ed25519 public key).',
    )
  }

  const agentKeyPath = expandHome(
    requireString(raw, 'agentKeyPath', DEFAULTS.agentKeyPath),
  )
  const stagingDbPath = expandHome(
    requireString(raw, 'stagingDbPath', DEFAULTS.stagingDbPath),
  )

  const vis = raw.defaultVisibility ?? DEFAULTS.defaultVisibility
  if (vis !== 'public' && vis !== 'unlisted' && vis !== 'private') {
    throw new Error(
      `agentxp plugin: defaultVisibility must be one of public|unlisted|private (got ${String(vis)})`,
    )
  }

  const autoFlushSteps = requireNonNegativeInt(
    raw,
    'autoFlushSteps',
    DEFAULTS.autoFlushSteps,
  )
  const autoFlushIdleMs = requireNonNegativeInt(
    raw,
    'autoFlushIdleMs',
    DEFAULTS.autoFlushIdleMs,
  )

  return {
    relayUrl,
    operatorPublicKey,
    agentKeyPath,
    defaultVisibility: vis,
    stagingDbPath,
    autoFlushSteps,
    autoFlushIdleMs,
  }
}

function requireNonNegativeInt(
  raw: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = raw[key]
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
    throw new Error(
      `agentxp plugin: config field "${key}" must be a non-negative integer (got ${String(v)})`,
    )
  }
  return v
}
