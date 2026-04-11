#!/usr/bin/env node
/**
 * tune-params.ts
 * Parameter tuning for contribution agents.
 *
 * Auto-adjustable:  score weights, heartbeat frequency multiplier
 * Human-guarded:    SOUL.md content, BOUNDARY.md content
 *
 * Usage: npx tsx agents/scripts/tune-params.ts --param <name> --value <value>
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import * as readline from 'readline'

// Parameters that can be auto-adjusted by the system
const AUTO_ADJUSTABLE_PARAMS = new Set([
  'score_weight_verification',
  'score_weight_search_hits',
  'score_weight_exploration_depth',
  'score_weight_recency',
  'heartbeat_frequency_multiplier',
  'curiosity_deepen_threshold',
  'hotspot_threshold',
])

// Parameters that require human confirmation
const HUMAN_GUARDED_PARAMS = new Set([
  'soul_content',
  'boundary_content',
  'soul',
  'boundary',
])

export interface TuneResult {
  success: boolean
  param: string
  value: unknown
  message: string
  requiresHumanConfirmation?: boolean
}

export interface AgentParams {
  score_weight_verification: number
  score_weight_search_hits: number
  score_weight_exploration_depth: number
  score_weight_recency: number
  heartbeat_frequency_multiplier: number
  curiosity_deepen_threshold: number
  hotspot_threshold: number
}

const DEFAULT_PARAMS: AgentParams = {
  score_weight_verification: 0.4,
  score_weight_search_hits: 0.3,
  score_weight_exploration_depth: 0.2,
  score_weight_recency: 0.1,
  heartbeat_frequency_multiplier: 1.0,
  curiosity_deepen_threshold: 3,
  hotspot_threshold: 50,
}

export function loadParams(paramsPath: string): AgentParams {
  if (!existsSync(paramsPath)) {
    return { ...DEFAULT_PARAMS }
  }
  try {
    const raw = readFileSync(paramsPath, 'utf8')
    return { ...DEFAULT_PARAMS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_PARAMS }
  }
}

export function saveParams(paramsPath: string, params: AgentParams): void {
  writeFileSync(paramsPath, JSON.stringify(params, null, 2) + '\n', 'utf8')
}

export function isAutoAdjustable(param: string): boolean {
  return AUTO_ADJUSTABLE_PARAMS.has(param)
}

export function isHumanGuarded(param: string): boolean {
  return HUMAN_GUARDED_PARAMS.has(param)
}

/**
 * Tune a parameter.
 * - Auto-adjustable params: updated immediately.
 * - Human-guarded params: throws error requiring human confirmation.
 * - Unknown params: throws error.
 */
export function tune(
  param: string,
  value: unknown,
  paramsPath: string
): TuneResult {
  // Check if human-guarded
  if (isHumanGuarded(param)) {
    throw new Error(
      `Parameter "${param}" requires human confirmation. ` +
        `This parameter controls core agent identity or ethical limits. ` +
        `Modify the relevant file (SOUL.md or BOUNDARY.md) directly with human oversight.`
    )
  }

  // Check if auto-adjustable
  if (!isAutoAdjustable(param)) {
    throw new Error(
      `Unknown parameter "${param}". ` +
        `Auto-adjustable params: ${[...AUTO_ADJUSTABLE_PARAMS].join(', ')}. ` +
        `Human-guarded params: ${[...HUMAN_GUARDED_PARAMS].join(', ')}.`
    )
  }

  // Validate value types
  const numericParams = new Set([
    'score_weight_verification',
    'score_weight_search_hits',
    'score_weight_exploration_depth',
    'score_weight_recency',
    'heartbeat_frequency_multiplier',
    'curiosity_deepen_threshold',
    'hotspot_threshold',
  ])

  if (numericParams.has(param)) {
    const numValue = typeof value === 'string' ? parseFloat(value) : Number(value)
    if (isNaN(numValue)) {
      throw new Error(`Parameter "${param}" requires a numeric value, got: ${value}`)
    }

    // Validate ranges
    if (
      param.startsWith('score_weight_') &&
      (numValue < 0 || numValue > 1)
    ) {
      throw new Error(
        `Score weight "${param}" must be between 0 and 1, got: ${numValue}`
      )
    }

    if (
      param === 'heartbeat_frequency_multiplier' &&
      (numValue <= 0 || numValue > 10)
    ) {
      throw new Error(
        `Heartbeat frequency multiplier must be between 0 and 10, got: ${numValue}`
      )
    }

    const params = loadParams(paramsPath)
    ;(params as Record<string, number>)[param] = numValue
    saveParams(paramsPath, params)

    return {
      success: true,
      param,
      value: numValue,
      message: `Updated ${param} = ${numValue}`,
    }
  }

  throw new Error(`Cannot tune parameter "${param}": unsupported type`)
}

/**
 * Interactive confirmation prompt for human-guarded params.
 * Returns true if confirmed, false otherwise.
 */
export async function promptHumanConfirmation(
  param: string,
  value: unknown
): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(
      `\n⚠️  HUMAN CONFIRMATION REQUIRED\n` +
        `Parameter "${param}" controls core agent identity or ethics.\n` +
        `New value: ${JSON.stringify(value)}\n` +
        `Type "yes" to confirm: `,
      (answer) => {
        rl.close()
        resolve(answer.trim().toLowerCase() === 'yes')
      }
    )
  })
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith('tune-params.ts')) {
  const args = process.argv.slice(2)

  let param = ''
  let rawValue = ''
  let agentId = ''

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--param' && args[i + 1]) {
      param = args[++i]
    } else if (args[i] === '--value' && args[i + 1]) {
      rawValue = args[++i]
    } else if (args[i] === '--agent' && args[i + 1]) {
      agentId = args[++i]
    }
  }

  if (!param || !rawValue) {
    console.error('Usage: tune-params.ts --param <name> --value <value> [--agent <id>]')
    process.exit(1)
  }

  const paramsPath = agentId
    ? resolve(process.cwd(), agentId, 'params.json')
    : resolve(process.cwd(), 'params.json')

  try {
    const result = tune(param, rawValue, paramsPath)
    console.log(result.message)
    process.exit(0)
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}
