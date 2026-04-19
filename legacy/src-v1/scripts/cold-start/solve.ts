#!/usr/bin/env npx tsx
// Cold-start solver: fetch pending questions, solve with Claude Code, publish solutions

import { parseArgs } from 'node:util'
import { execSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEvent, signEvent } from '../../packages/protocol/src/index.js'
import type { AgentKey, SerendipEvent } from '../../packages/protocol/src/types.js'
import { publishEvent } from './publish.js'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface SolverConfig {
  relayUrl: string
  operatorKey: { publicKey: string; privateKey: Uint8Array }
}

// ─────────────────────────────────────────────────────────────
// Fetch pending questions from relay
// ─────────────────────────────────────────────────────────────

export async function fetchPendingQuestions(
  relayUrl: string,
  limit?: number,
): Promise<unknown[]> {
  const url = `${relayUrl}/api/cold-start/questions?status=pending${limit != null ? `&limit=${limit}` : ''}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch questions: HTTP ${response.status}`)
  }

  const body = (await response.json()) as { questions: unknown[] }
  return body.questions
}

// ─────────────────────────────────────────────────────────────
// Solve a single question via Claude Code
// ─────────────────────────────────────────────────────────────

export async function solveQuestion(
  question: { event_id: string; payload: string | { type: string; data: { title?: string; body?: string } } },
  config: SolverConfig,
): Promise<{ ok: boolean; error?: string }> {
  // Parse payload if it's a string (from DB row)
  const payload = typeof question.payload === 'string'
    ? JSON.parse(question.payload) as { type: string; data: { title?: string; body?: string } }
    : question.payload
  const title = payload.data?.title ?? 'Unknown'
  const body = payload.data?.body ?? ''

  // Create temp working directory
  const tmpDir = join(tmpdir(), `agentxp-solve-${question.event_id.slice(0, 8)}`)
  mkdirSync(tmpDir, { recursive: true })

  let claudeOutput: string
  try {
    // Invoke Claude Code CLI
    const prompt = [
      '你是一个技术专家。请解答以下问题并提供可验证的步骤：',
      '',
      `标题：${title}`,
      '',
      `问题详情：${body}`,
      '',
      '请提供：',
      '1. 问题根因分析',
      '2. 解决步骤（每步可执行）',
      '3. 验证方法',
    ].join('\n')

    claudeOutput = execSync(
      `claude -p ${JSON.stringify(prompt)} --max-turns 5 --dangerously-skip-permissions`,
      { cwd: tmpDir, encoding: 'utf-8', timeout: 300_000 },
    )
  } catch (err) {
    // Clean up on failure
    rmSync(tmpDir, { recursive: true, force: true })
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Claude invocation failed: ${message}` }
  }

  // Build and sign the solution event
  try {
    const agentKey: AgentKey = {
      publicKey: config.operatorKey.publicKey,
      privateKey: config.operatorKey.privateKey,
      delegatedBy: config.operatorKey.publicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
    }

    const solutionPayload = {
      type: 'experience.solution',
      data: {
        question_id: question.event_id,
        solution: claudeOutput,
        env: {
          node: process.version,
          platform: process.platform,
        },
      },
    }

    const unsignedEvent = createEvent(
      'experience.solution' as Parameters<typeof createEvent>[0],
      solutionPayload,
      ['cold-start', 'solution'],
    )
    const signedEvent: SerendipEvent = await signEvent(unsignedEvent, agentKey)

    const publishResult = await publishEvent(signedEvent, config.relayUrl)
    if (!publishResult.ok) {
      return { ok: false, error: `Publish failed: ${publishResult.error}` }
    }

    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Event creation/publish failed: ${message}` }
  } finally {
    // Always clean up temp directory
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ─────────────────────────────────────────────────────────────
// Run solver loop
// ─────────────────────────────────────────────────────────────

export async function runSolver(
  config: SolverConfig,
  limit?: number,
): Promise<{ solved: number; failed: number }> {
  const questions = await fetchPendingQuestions(config.relayUrl, limit)
  let solved = 0
  let failed = 0

  for (const q of questions) {
    const result = await solveQuestion(
      q as { event_id: string; payload: string },
      config,
    )
    if (result.ok) {
      solved++
    } else {
      failed++
      console.error(`Failed to solve ${(q as { event_id: string }).event_id}: ${result.error}`)
    }
  }

  return { solved, failed }
}

// ─────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      relay: { type: 'string', default: 'http://localhost:3141' },
      limit: { type: 'string' },
    },
    strict: false,
  })

  const relayUrl = values.relay as string

  // For CLI usage, generate a temporary operator key
  const { generateOperatorKey } = await import('../../packages/protocol/src/index.js')
  const operatorKey = await generateOperatorKey()

  const config: SolverConfig = { relayUrl, operatorKey }
  const limit = values.limit ? Number(values.limit) : undefined

  console.log(`Solver starting — relay: ${relayUrl}, limit: ${limit ?? 'none'}`)

  const stats = await runSolver(config, limit)
  console.log(`Done — solved: ${stats.solved}, failed: ${stats.failed}`)
}

// Run if executed directly
const isDirectRun = process.argv[1]?.endsWith('solve.ts') ||
                    process.argv[1]?.includes('solve')
if (isDirectRun) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
