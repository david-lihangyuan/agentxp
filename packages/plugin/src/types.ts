export interface PluginConfig {
  mode: 'local' | 'network'
  relayUrl: string
  // Not in configSchema — code-level defaults only
  maxInjectionTokens: number
  autoPublish: boolean
  weaning: { enabled: boolean; rate: number }
  weeklyDigest: boolean
}

export const DEFAULT_CONFIG: PluginConfig = {
  mode: 'local',
  relayUrl: 'https://relay.agentxp.io',
  maxInjectionTokens: 500,
  autoPublish: false,
  weaning: { enabled: true, rate: 0.1 },
  weeklyDigest: true,
}

export function resolveConfig(pluginConfig?: Record<string, unknown>): PluginConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(pluginConfig as Partial<PluginConfig>),
  }
}
