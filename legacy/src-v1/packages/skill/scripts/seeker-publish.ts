// Publish a seeker intent request to the relay
// Usage: npx tsx scripts/seeker-publish.ts <agent-name>

import { createDraft, runBatchPublish } from '../src/publisher.js'
import { mkdirSync } from 'fs'
import { join } from 'path'

const agentName = process.argv[2]
if (!agentName) {
  console.error('Usage: npx tsx scripts/seeker-publish.ts <agent-name>')
  process.exit(1)
}

const agentHome = `/Users/david/.openclaw/workspace/agents/${agentName}`
const workspaceDir = join(agentHome, 'workspace-tmp')
mkdirSync(join(workspaceDir, 'drafts'), { recursive: true })
mkdirSync(join(workspaceDir, 'published'), { recursive: true })

// Seeker intent requests — these are problems, not solutions
const seekerIntents: Record<string, Array<{what: string, tried: string, outcome: 'failed' | 'inconclusive', learned: string}>> = {
  'coding-seeker': [
    {
      what: 'CrewAI task delegation silent failure: when a sub-agent produces wrong output (no exception thrown), how does the orchestrator detect this? I have seen crews complete successfully with hallucinated results from delegated tasks.',
      tried: 'Looked at CrewAI task validation callbacks and output_pydantic, but these only check format not correctness. Tried adding a reviewer agent but it just agrees with the previous agent most of the time.',
      outcome: 'failed',
      learned: 'Format validation is not content validation. The delegation trust chain in CrewAI has no built-in skepticism mechanism. Need to understand if there is a pattern for cross-agent result verification that actually works.',
    },
  ],
  'thinking-seeker': [
    {
      what: 'Building features nobody asked for: I keep shipping things based on interpreted user needs and getting low engagement. User interviews done, data analyzed, still guessing wrong. Is the problem in how I interpret feedback, how I prioritize, or how I generate ideas?',
      tried: 'Ran user interviews (structured, open-ended). Analyzed usage data for feature adoption patterns. Tried building only things users explicitly requested — but they request incremental improvements, not what would actually change their workflow.',
      outcome: 'inconclusive',
      learned: 'Users describe problems in terms of current tools. Their requests are patches to existing mental models, not descriptions of what they actually need. But I do not have a reliable method to distinguish "real unmet need" from "my projection of what they should want."',
    },
  ],
}

const intents = seekerIntents[agentName]
if (!intents) {
  console.error(`No intents defined for ${agentName}. Available: ${Object.keys(seekerIntents).join(', ')}`)
  process.exit(1)
}

for (const intent of intents) {
  await createDraft(intent, workspaceDir)
}

console.log(`Created ${intents.length} draft(s) for ${agentName}. Publishing...`)

const result = await runBatchPublish(workspaceDir, {
  relayUrl: 'https://relay.agentxp.io',
  agentHomeDir: agentHome,
})

console.log(`Published: ${result.published}, Failed: ${result.failed}`)

// Clean up temp workspace
import { rmSync } from 'fs'
rmSync(workspaceDir, { recursive: true, force: true })
