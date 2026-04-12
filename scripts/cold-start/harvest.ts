#!/usr/bin/env npx tsx
// Cold-start harvester: fetch Stack Overflow questions and publish as SerendipEvents

import { parseArgs } from 'node:util'
import { generateOperatorKey } from '../../packages/protocol/src/index.js'
import { fetchQuestions } from './so-client.js'
import { questionToEvent } from './question-event.js'
import { publishEvent } from './publish.js'

const DEFAULT_TAGS = ['openclaw', 'claude-code', 'ai-agent', 'mcp-protocol']
const DEFAULT_LIMIT = 20
const DEFAULT_RELAY = 'http://localhost:3141'

export interface HarvestResult {
  published: number
  skipped: number
  failed: number
}

export async function runHarvest(
  tags: string[],
  limit: number,
  relayUrl: string,
): Promise<HarvestResult> {
  const operatorKey = await generateOperatorKey()

  let published = 0
  let skipped = 0
  let failed = 0

  for (const tag of tags) {
    let questions: Awaited<ReturnType<typeof fetchQuestions>>
    try {
      questions = await fetchQuestions([tag], { pageSize: limit })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[harvest] ✗ failed to fetch tag "${tag}" — ${msg}`)
      skipped++
      continue
    }

    if (!questions || !Array.isArray(questions)) {
      console.error(`[harvest] ✗ no questions returned for tag "${tag}"`)
      skipped++
      continue
    }

    for (const q of questions) {
      try {
        const event = await questionToEvent(q, operatorKey)
        const result = await publishEvent(event, relayUrl)
        if (result.ok) {
          console.log(`[harvest] ✓ published: ${q.title}`)
          published++
        } else {
          console.error(`[harvest] ✗ failed: ${q.title} — ${result.error}`)
          failed++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[harvest] ✗ failed: ${q.title} — ${msg}`)
        failed++
      }
    }
  }

  console.log(`\n[harvest] done — published=${published} skipped=${skipped} failed=${failed}`)
  return { published, skipped, failed }
}

/**
 * CLI-compatible entry point. Accepts optional argv array for testability.
 * Returns the harvest result for programmatic callers.
 */
export async function main(argv?: string[]): Promise<HarvestResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      tags: { type: 'string', default: DEFAULT_TAGS.join(',') },
      limit: { type: 'string', default: String(DEFAULT_LIMIT) },
      relay: { type: 'string', default: DEFAULT_RELAY },
    },
    strict: false,
  })

  const tags = values.tags!.split(',').map((t) => t.trim()).filter(Boolean)
  const limit = parseInt(values.limit!, 10)
  const relayUrl = values.relay!

  return runHarvest(tags, limit, relayUrl)
}

// Only auto-execute when run directly (not when imported by tests)
const isDirectRun = process.argv[1]?.endsWith('harvest.ts') || process.argv[1]?.endsWith('harvest.js')
if (isDirectRun) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
