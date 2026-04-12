#!/usr/bin/env npx tsx
// Cold-start pipeline: run harvest → solve → verify end-to-end

import { parseArgs } from 'node:util'
import { generateOperatorKey } from '../../packages/protocol/src/index.js'
import { runHarvest } from './harvest.js'
import { runSolver } from './solve.js'
import { runVerifier } from './verify.js'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface PipelineStats {
  harvest: { published: number; failed: number }
  solver: { solved: number; failed: number }
  verifier: { passed: number; failed: number; errors: number }
}

export interface PipelineResult {
  success: boolean
  stats: PipelineStats
}

// ─────────────────────────────────────────────────────────────
// Pipeline runner
// ─────────────────────────────────────────────────────────────

export async function runPipeline(relayUrl: string): Promise<PipelineResult> {
  const operatorKey = await generateOperatorKey()

  // ── Step 1: Harvest ──────────────────────────────────────
  console.log('\n[pipeline] ── Step 1: Harvest ──')
  const harvestStats = await runHarvest({
    tags: ['test'],
    limit: 3,
    relayUrl,
  })
  console.log(`[pipeline] harvest: published=${harvestStats.published} failed=${harvestStats.failed}`)

  // ── Step 2: Solve ────────────────────────────────────────
  console.log('\n[pipeline] ── Step 2: Solve ──')
  const solverStats = await runSolver({ relayUrl, operatorKey })
  console.log(`[pipeline] solver: solved=${solverStats.solved} failed=${solverStats.failed}`)

  // ── Step 3: Verify ───────────────────────────────────────
  console.log('\n[pipeline] ── Step 3: Verify ──')
  const verifierStats = await runVerifier({ relayUrl, operatorKey })
  console.log(`[pipeline] verifier: passed=${verifierStats.passed} failed=${verifierStats.failed} errors=${verifierStats.errors}`)

  // ── Summary ──────────────────────────────────────────────
  const stats: PipelineStats = {
    harvest: harvestStats,
    solver: solverStats,
    verifier: verifierStats,
  }

  const success = harvestStats.published > 0
  console.log(`\n[pipeline] ══ Result: ${success ? '✓ SUCCESS' : '✗ FAIL'} ══`)

  return { success, stats }
}

// ─────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      relay: { type: 'string', default: 'http://localhost:3141' },
    },
    strict: false,
  })

  const relayUrl = values.relay as string
  console.log(`[pipeline] Starting cold-start pipeline — relay: ${relayUrl}`)

  const result = await runPipeline(relayUrl)

  if (!result.success) {
    process.exit(1)
  }
}

const isDirectRun =
  process.argv[1]?.endsWith('pipeline.ts') ||
  process.argv[1]?.endsWith('pipeline.js')

if (isDirectRun) {
  main().catch((err) => {
    console.error('[pipeline] Fatal error:', err)
    process.exit(1)
  })
}
