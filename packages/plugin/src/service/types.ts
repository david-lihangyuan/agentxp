/**
 * Shared types for the AgentXP background service modules.
 */

export interface PluginLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
  debug: (msg: string) => void
}

export interface ServiceModule {
  id: string
  intervalMs: number
  condition: () => boolean
  run: () => Promise<void>
}

export interface ModuleState {
  lastRun: number
  consecutiveFailures: number
  backoffMs: number
}
