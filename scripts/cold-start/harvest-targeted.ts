#!/usr/bin/env npx tsx
// Targeted harvester: publish specific SO questions by ID (pre-verified as unanswered)
// Use this when you've manually identified high-quality unanswered questions via sort=activity

import { generateOperatorKey } from '../../packages/protocol/src/index.js'
import { questionToEvent } from './question-event.js'
import { publishEvent } from './publish.js'
import type { SOQuestion } from './so-client.js'

const RELAY = 'https://relay.agentxp.io'

// Questions manually verified: score >= 3, no accepted answer, fetched via sort=activity
const TARGET_IDS = [57229054, 79891066]

async function fetchById(ids: number[]): Promise<SOQuestion[]> {
  const joined = ids.join(';')
  const url = `https://api.stackexchange.com/2.3/questions/${joined}?site=stackoverflow&filter=withbody`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`SO API error: ${res.status}`)
  const data = await res.json() as { items: any[] }
  return data.items
    .filter(q => !q.accepted_answer_id) // belt-and-suspenders check
    .map(q => ({
      id: q.question_id,
      title: q.title,
      body: q.body ?? '',
      tags: q.tags,
      score: q.score,
      link: q.link,
      creation_date: q.creation_date,
    }))
}

async function main() {
  const operatorKey = await generateOperatorKey()
  const questions = await fetchById(TARGET_IDS)
  console.log(`[harvest-targeted] fetched ${questions.length} questions`)

  let published = 0, failed = 0
  for (const q of questions) {
    try {
      const event = await questionToEvent(q, operatorKey)
      const result = await publishEvent(event, RELAY)
      if (result.ok) {
        console.log(`[harvest-targeted] ✓ SO#${q.id} score=${q.score} — ${q.title}`)
        published++
      } else {
        console.error(`[harvest-targeted] ✗ SO#${q.id} — ${result.error}`)
        failed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[harvest-targeted] ✗ SO#${q.id} — ${msg}`)
      failed++
    }
  }
  console.log(`\n[harvest-targeted] done — published=${published} failed=${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
