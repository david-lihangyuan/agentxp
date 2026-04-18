// Tier-1 in-session capture and Tier-2 end-of-session reflection.
// Per ADR-001 both tiers share the same event schema and produce
// staged drafts; Tier-2 is the publish cycle.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExperienceData } from '@serendip/protocol'
import { loadOperatorKey, ensureAgentKey } from './identity.js'
import { openDraftStore } from './drafts.js'
import type { DraftRow, DraftStore, ReflectionTier } from './drafts.js'
import { publishDrafts, type PublishResult } from './publisher.js'

export interface SkillConfig {
  relay_url: string
  agent_id: string
}

export interface DraftInput {
  what: string
  tried: string
  outcome: ExperienceData['outcome']
  learned: string
  tags?: string[]
  scope?: ExperienceData['scope']
}

const OUTCOMES = new Set(['succeeded', 'failed', 'partial', 'inconclusive'])

export class DraftValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message)
    this.name = 'DraftValidationError'
  }
}

function validate(input: DraftInput): ExperienceData {
  if (!input.what.trim()) throw new DraftValidationError('what', 'what is required')
  if (!input.tried.trim()) throw new DraftValidationError('tried', 'tried is required')
  if (!input.learned.trim()) throw new DraftValidationError('learned', 'learned is required')
  if (!OUTCOMES.has(input.outcome)) {
    throw new DraftValidationError('outcome', `outcome must be one of ${[...OUTCOMES].join('|')}`)
  }
  return {
    what: input.what,
    tried: input.tried,
    outcome: input.outcome,
    learned: input.learned,
    ...(input.scope ? { scope: input.scope } : {}),
  }
}

export function captureInSessionDraft(
  store: DraftStore,
  input: DraftInput,
  now: number = Math.floor(Date.now() / 1000),
): DraftRow {
  const data = validate(input)
  return store.add('in-session', data, input.tags ?? [], now)
}

export function captureEndOfSessionDraft(
  store: DraftStore,
  input: DraftInput,
  now: number = Math.floor(Date.now() / 1000),
): DraftRow {
  const data = validate(input)
  return store.add('end-of-session', data, input.tags ?? [], now)
}

export interface ReflectOptions {
  targetDir: string
  identityRoot?: string
  fetch?: typeof globalThis.fetch
  now?: () => number
}

export interface ReflectOutcome {
  published: PublishResult[]
  retry: PublishResult[]
  rejected: PublishResult[]
}

function loadConfig(targetDir: string): SkillConfig {
  const configPath = join(targetDir, '.agentxp', 'config.json')
  if (!existsSync(configPath)) {
    return { relay_url: 'http://localhost:3141', agent_id: 'default' }
  }
  return JSON.parse(readFileSync(configPath, 'utf8')) as SkillConfig
}

export function openStoreForTarget(targetDir: string): DraftStore {
  const dbPath = join(targetDir, '.agentxp', 'drafts.sqlite')
  return openDraftStore(dbPath)
}

export async function reflect(opts: ReflectOptions): Promise<ReflectOutcome> {
  const config = loadConfig(opts.targetDir)
  // Identity check runs first so the user sees "operator key not found"
  // rather than an incidental SQLite error.
  const operator = loadOperatorKey(opts.identityRoot)
  const agent = await ensureAgentKey(operator, config.agent_id, 30, opts.identityRoot)
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(opts.targetDir, '.agentxp'), { recursive: true })
  const store = openStoreForTarget(opts.targetDir)
  try {
    const publishOpts: Parameters<typeof publishDrafts>[0] = {
      relayUrl: config.relay_url,
      agent,
      store,
    }
    if (opts.fetch) publishOpts.fetch = opts.fetch
    if (opts.now) publishOpts.now = opts.now
    const results = await publishDrafts(publishOpts)
    return {
      published: results.filter((r) => r.status === 'published'),
      retry: results.filter((r) => r.status === 'retry'),
      rejected: results.filter((r) => r.status === 'rejected'),
    }
  } finally {
    store.close()
  }
}

export type { DraftRow, ReflectionTier }
