/**
 * commands.ts — /xp chat command for AgentXP plugin.
 *
 * Subcommands: status (default), pause, resume, unpublish
 */

import type { Db } from './db.js'
import type { PluginConfig } from './types.js'

// ─── Pause state ───────────────────────────────────────────────────────────

let _paused = false

export function isPaused(): boolean {
  return _paused
}

export function setPaused(v: boolean): void {
  _paused = v
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PluginCommandContext {
  args?: string
  channelId?: string
  accountId?: string
}

export interface PluginCommandResult {
  text?: string
}

export interface XpCommandDefinition {
  name: string
  description: string
  acceptsArgs: boolean
  requireAuth: boolean
  handler: (ctx: PluginCommandContext) => Promise<PluginCommandResult>
}

// ─── Handlers ──────────────────────────────────────────────────────────────

function handleStatus(db: Db, config: PluginConfig): PluginCommandResult {
  const lessonCount = db.getLessonCount()
  const outdatedCount = db.getOutdatedLessonCount()
  const stats = db.getInjectionStats()
  const pct =
    stats.total > 0 ? Math.round((stats.injected / stats.total) * 100) : 0
  const publishedCount = db.getPublishedCount()
  const pauseLabel = _paused ? '⏸ paused' : '▶ active'

  const lines = [
    '📊 AgentXP Status',
    '━━━━━━━━━━━━━━━━',
    `Local lessons: ${lessonCount}${outdatedCount > 0 ? ` (${outdatedCount} outdated)` : ''}`,
    `Injections: ${stats.total} sessions, ${stats.injected} injected (${pct}%)`,
    `Published: ${publishedCount} (${config.mode} mode)`,
    `State: ${pauseLabel}`,
    `Mode: ${config.mode}${config.mode === 'network' ? ` | Relay: ${config.relayUrl}` : ''}`,
  ]

  return { text: lines.join('\n') }
}

function handlePause(): PluginCommandResult {
  _paused = true
  return { text: '⏸ AgentXP paused. Injection and extraction disabled.' }
}

function handleResume(): PluginCommandResult {
  _paused = false
  return { text: '▶ AgentXP resumed.' }
}

function handleUnpublish(db: Db): PluginCommandResult {
  const last = db.getLastPublish()
  if (!last) {
    return { text: 'Nothing published yet.' }
  }
  db.markUnpublished(last.lessonId)
  const relayInfo = last.relayEventId
    ? ` (relay event: ${last.relayEventId})`
    : ''
  return { text: `Unpublished lesson #${last.lessonId}${relayInfo}` }
}

// ─── Command Factory ───────────────────────────────────────────────────────

export function createXpCommand(
  db: Db,
  config: PluginConfig,
): XpCommandDefinition {
  return {
    name: 'xp',
    description: 'AgentXP experience learning status and controls',
    acceptsArgs: true,
    requireAuth: true,
    async handler(ctx: PluginCommandContext): Promise<PluginCommandResult> {
      const args = (ctx.args ?? '').trim()
      const sub = args.split(/\s+/)[0] || 'status'

      switch (sub) {
        case 'status':
          return handleStatus(db, config)
        case 'pause':
          return handlePause()
        case 'resume':
          return handleResume()
        case 'unpublish':
          return handleUnpublish(db)
        default:
          return {
            text: `Unknown subcommand: ${sub}. Available: status, pause, resume, unpublish`,
          }
      }
    },
  }
}
