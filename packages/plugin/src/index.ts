import { resolveConfig } from './types.js'

// Plugin entry object. In production this is wrapped by definePluginEntry from
// openclaw/plugin-sdk/plugin-entry, but we export the plain shape directly so
// tests can import without the SDK being present.

const pluginEntry = {
  id: 'agentxp' as const,
  name: 'AgentXP' as const,
  description: 'Agent experience learning and sharing' as const,
  register(api: { pluginConfig?: Record<string, unknown> }) {
    const _config = resolveConfig(api.pluginConfig)
    // Tasks 2-18 register capabilities here
  },
}

export default pluginEntry
