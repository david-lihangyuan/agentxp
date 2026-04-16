#!/usr/bin/env npx tsx
// Harvest GitHub issues as cold-start questions — Round 6 (2026-04-14)

import { generateOperatorKey, createEvent, signEvent } from '../../packages/protocol/src/index.js'
import { publishEvent } from './publish.js'
import type { AgentKey } from '../../packages/protocol/src/types.js'

const RELAY = 'https://relay.agentxp.io'

interface GHIssue {
  number: number
  title: string
  body: string
  url: string
  tags: string[]
  score: number
}

const TARGET_ISSUES: GHIssue[] = [
  {
    number: 66523,
    title: '[Bug] OPENCLAW_STATE_DIR Environment Variable Ignored on Windows',
    body: 'OPENCLAW_STATE_DIR environment variable is ignored on Windows Server 2019. Gateway processes continue using the default C:\\Users\\<username>\\.openclaw directory instead of the configured path. Steps: set OPENCLAW_STATE_DIR in PM2 ecosystem.json env block (e.g. "OPENCLAW_STATE_DIR": "D:\\100_OpenClaw\\.openclaw"), start gateway via PM2, delete the default home dir. Gateway recreates C:\\Users\\Administrator\\.openclaw automatically. pm2 env 0 confirms the env var IS set correctly at the process level but the gateway ignores it. Root cause likely in resolveStateDir or resolveDataDir where path resolution falls back to os.homedir() before checking OPENCLAW_STATE_DIR, possibly because env var lookup uses process.env["OPENCLAW_STATE_DIR"] but Windows PM2 fork mode injects vars differently, or because Windows backslash path comparison fails in the fallback check. Environment: Windows Server 2019, Node.js v22.22.2, OpenClaw 2026.4.11, PM2 fork mode.',
    url: 'https://github.com/openclaw/openclaw/issues/66523',
    tags: ['openclaw', 'windows', 'env-var', 'state-dir', 'config', 'bug'],
    score: 7
  },
  {
    number: 66531,
    title: '[Feature]: Add agent.abort RPC to cancel embedded agent runs',
    body: 'OpenClaw gateway has no RPC to cancel runs started via the agent() RPC. chat.abort only cancels chat.send-initiated runs; it only checks chatAbortControllers, but agent() runs register into ACTIVE_EMBEDDED_RUNS (sessionId-keyed) at src/agents/pi-embedded-runner/run/attempt.ts:1572 and never into chatAbortControllers. So calling chat.abort after an agent() run is a no-op. The underlying cancel primitive abortEmbeddedPiRun(sessionId) exists in src/agents/pi-embedded.ts but has no RPC surface. Needed: a new agent.abort RPC method that accepts sessionId and calls abortEmbeddedPiRun. The agent handlers map at src/gateway/server-methods/agent.ts needs a new handler. Also, the abort controller should be registered in chatAbortControllers for uniformity, OR chat.abort should be extended to also check ACTIVE_EMBEDDED_RUNS. Affects any client (Control UI, custom integrations) that uses the agent() RPC and needs to cancel mid-run.',
    url: 'https://github.com/openclaw/openclaw/issues/66531',
    tags: ['openclaw', 'gateway', 'rpc', 'agent', 'abort', 'embedded-pi', 'feature'],
    score: 8
  },
  {
    number: 66530,
    title: '[Feature]: Primary model should be probed for recovery after fallback due to timeout',
    body: 'When the primary model times out and OpenClaw falls back to a secondary model, the session becomes permanently "sticky" on the fallback model — the primary is never re-probed. Concrete example: MiniMax-M2.7 (200k context) as primary, DeepSeek-V3.2 (16k context) as fallback. After one MiniMax timeout, all subsequent requests use DeepSeek permanently. User must manually toggle the model back. Root cause: the fallback machinery in the model selection path records the fallback decision but has no recovery probing loop. After a successful fallback, no timer or counter attempts to route the next request back to the primary to check if it recovered. Needed: after N successful fallback responses (configurable), probe the primary with a lightweight request. If it succeeds, return to primary. If it fails, stay on fallback for another N requests. This is especially painful for multi-model chains where primary and fallback have different context window sizes — context overflow bugs manifest after fallback stickiness.',
    url: 'https://github.com/openclaw/openclaw/issues/66530',
    tags: ['openclaw', 'fallback', 'model-recovery', 'primary-model', 'timeout', 'feature'],
    score: 7
  }
]

async function main() {
  const operatorKey = await generateOperatorKey()

  const agentKey: AgentKey = {
    publicKey: operatorKey.publicKey,
    privateKey: operatorKey.privateKey,
    delegatedBy: operatorKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
  }

  let published = 0, failed = 0

  for (const issue of TARGET_ISSUES) {
    try {
      const payload = {
        type: 'intent.question',
        data: {
          source: 'github',
          url: issue.url,
          title: issue.title,
          body: issue.body,
          tags: issue.tags,
          score: issue.score,
        }
      }

      const unsignedEvent = createEvent('intent.question' as any, payload, issue.tags)
      const event = await signEvent(unsignedEvent, agentKey)
      const result = await publishEvent(event, RELAY)

      if (result.ok) {
        console.log(`[harvest-github-r6] ✓ #${issue.number} — ${issue.title.slice(0, 60)}`)
        published++
      } else {
        console.error(`[harvest-github-r6] ✗ #${issue.number} — ${result.error}`)
        failed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[harvest-github-r6] ✗ #${issue.number} — ${msg}`)
      failed++
    }
  }

  console.log(`\n[harvest-github-r6] done — published=${published} failed=${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
