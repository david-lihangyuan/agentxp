// Cold Start Harvester — fetches SO questions and publishes to relay
// Usage: npx tsx scripts/cold-start/harvest.ts [--tags openclaw,claude-code] [--limit 20] [--relay http://localhost:3141]

import { fetchQuestions } from './so-client.js'
import { questionToEvent } from './question-event.js'
import { publishEvent } from './publish.js'
import { generateOperatorKey } from '../../packages/protocol/src/index.js'

const HARVEST_TAGS = ['openclaw', 'claude-code', 'ai-agent', 'mcp-protocol', 'anthropic']
const DEFAULT_RELAY = 'http://localhost:3141'
const DEFAULT_LIMIT = 20
const MIN_VOTES = 1

export async function main(args: string[] = process.argv.slice(2)): Promise<{ published: number; skipped: number; failed: number }> {
  const tagsArg = args.find(a => a.startsWith('--tags='))
  const limitArg = args.find(a => a.startsWith('--limit='))
  const relayArg = args.find(a => a.startsWith('--relay='))

  const tags = tagsArg ? tagsArg.split('=')[1].split(',') : HARVEST_TAGS
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : DEFAULT_LIMIT
  const relayUrl = relayArg ? relayArg.split('=')[1] : DEFAULT_RELAY

  console.log(`[harvest] tags=${tags.join(',')} limit=${limit} relay=${relayUrl}`)

  // Generate operator key for this harvest run
  const operatorKey = await generateOperatorKey()
  console.log(`[harvest] operator pubkey=${operatorKey.publicKey.slice(0, 16)}...`)

  let published = 0
  let skipped = 0
  let failed = 0

  for (const tag of tags) {
    console.log(`[harvest] fetching tag: ${tag}`)
    try {
      const questions = await fetchQuestions([tag], { minVotes: MIN_VOTES, pageSize: Math.min(limit, 30) })
      console.log(`[harvest] fetched ${questions.length} questions for tag ${tag}`)

      for (const q of questions.slice(0, limit)) {
        try {
          const event = await questionToEvent(q, operatorKey)
          const result = await publishEvent(event, relayUrl)
          if (result.ok) {
            published++
            console.log(`[harvest] ✓ published: ${q.title.slice(0, 60)}`)
          } else {
            failed++
            console.error(`[harvest] ✗ failed: ${q.title.slice(0, 60)} — ${result.error}`)
          }
        } catch (err) {
          failed++
          console.error(`[harvest] ✗ error on question ${q.id}: ${err}`)
        }
      }
    } catch (err) {
      console.error(`[harvest] ✗ failed to fetch tag ${tag}: ${err}`)
    }

    // Respect SO API rate limiting between tags
    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`[harvest] done. published=${published} skipped=${skipped} failed=${failed}`)
  return { published, skipped, failed }
}

// Run when invoked directly via tsx / node
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[harvest] fatal:', err)
    process.exit(1)
  })
}
