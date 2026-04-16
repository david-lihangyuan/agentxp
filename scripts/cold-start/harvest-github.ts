#!/usr/bin/env npx tsx
// GitHub issue harvester — publish OpenClaw/ecosystem GitHub issues as cold-start questions

import { generateOperatorKey, createEvent, signEvent } from '../../packages/protocol/src/index.js'
import { publishEvent } from './publish.js'
import type { AgentKey } from '../../packages/protocol/src/types.js'

const RELAY = 'https://relay.agentxp.io'

interface GitHubIssue {
  number: number
  title: string
  body: string
  url: string
  tags: string[]
  score: number
}

// GitHub issues manually selected: relevant to AI agent developers, no accepted answer
const TARGET_ISSUES: GitHubIssue[] = [
  {
    number: 66460,
    url: 'https://github.com/openclaw/openclaw/issues/66460',
    title: '[Bug]: cron-owned exec completion events are incorrectly relayed to the user by heartbeat',
    body: `After an isolated cron run completes with its own final result, OpenClaw still relays the cron-internal exec completion event to the user through heartbeat as a separate user-facing async-result message.

Steps to reproduce:
1. Configure cron/jobs.json with an isolated cron job
2. Run: openclaw cron run --expect-final <job-id>
3. Observe the cron run transcript — job finishes with expected result
4. Later heartbeat relay transcript shows the cron-internal exec completion event relayed to the user as a separate async-result message

Expected: cron-owned exec completion events should not be visible to the user via heartbeat.
Actual: heartbeat relays internal cron exec completions as user-facing messages.

Environment: OpenClaw 2026.4.11, Linux`,
    tags: ['openclaw', 'cron', 'heartbeat', 'multi-agent', 'exec', 'bug'],
    score: 5,
  },
  {
    number: 66467,
    url: 'https://github.com/openclaw/openclaw/issues/66467',
    title: 'ACP session/update usage_update notification fails validation when used=null (Invalid params / expected object, received undefined)',
    body: `Discord-bound ACP sessions fail during session/update notification handling when the ACP runtime emits a usage_update notification with used: null.

Error observed in OpenClaw logs:
\`\`\`
Error handling notification {
  jsonrpc: '2.0',
  method: 'session/update',
  params: {
    sessionId: 'ba706432-d8f3-431b-ad57-bd0f0a5dc131',
    update: {
      sessionUpdate: 'usage_update',
      used: null,
      size: 200000,
      cost: [Object]
    }
  }
} {
  code: -32602,
  message: 'Invalid params'
}
\`\`\`

Validation errors include: expected object, received undefined for sessionUpdate, title, toolCallId, entries, availableCommands, currentModeId, configOptions, used.

This is a runtime/schema mismatch in OpenClaw's ACP notification handler — it does not handle the null case for used field.

Environment: OpenClaw 2026.4.11, Discord channel`,
    tags: ['openclaw', 'acp', 'discord', 'validation', 'session', 'bug'],
    score: 4,
  },
  {
    number: 66462,
    url: 'https://github.com/openclaw/openclaw/issues/66462',
    title: 'Embedded Pi agent enters compaction loop on repeated 400 errors with no response body (openai-completions API)',
    body: `When using a custom provider with api: "openai-completions" that proxies to Anthropic Claude or other reasoning models, the embedded Pi agent (used by active-memory, compaction, and other sub-agent flows) enters an infinite compaction loop when the provider returns 400 with no response body.

Loop pattern:
1. Initial request times out / hits idle timeout at proxy
2. Retry receives 400 with empty body
3. OpenClaw classifies as format error → triggers compaction → retries → same 400 again → loop

This affects any openai-completions provider behind a proxy/gateway. The agent never recovers — only manual restart helps.

Steps to reproduce:
1. Configure provider with api: "openai-completions" pointing to a proxy
2. Trigger an idle timeout so the proxy returns 400 with no body
3. Observe Pi agent entering compaction loop

Environment: OpenClaw 2026.4.11, custom openai-completions proxy provider`,
    tags: ['openclaw', 'pi-agent', 'compaction', 'openai-completions', 'loop', 'proxy', 'bug'],
    score: 6,
  },
  {
    number: 66469,
    url: 'https://github.com/openclaw/openclaw/issues/66469',
    title: 'restoreMemoryPluginState clears capability when called from resolvePluginProviders (shouldActivate=false)',
    body: `wiki_status always shows "exported artifacts: 0" even though memory-core registers publicArtifacts successfully on Gateway startup.

Root cause: restoreMemoryPluginState() in memory-state-CZkKzb0u.js is called repeatedly from resolvePluginProviders → resolveRuntimePluginRegistry → loadOpenClawPlugins with shouldActivate=false. Each call clears memoryPluginState.capability to void 0 because the state object from the !shouldActivate branch does not include a capability field.

Bug location: In loader-DuIH27tS.js ~line 2674, the loader saves previousMemoryRuntime, previousMemoryPromptBuilder, previousMemoryCorpusSupplements before calling register(api), but does NOT save previousMemoryCapability. When restoreMemoryPluginState is called with shouldActivate=false, it resets capability to undefined.

Result: any plugin that calls resolvePluginProviders with shouldActivate=false will lose its capability registration.

Environment: OpenClaw 2026.4.11, memory plugin with publicArtifacts`,
    tags: ['openclaw', 'memory', 'plugin', 'capability', 'wiki', 'bug'],
    score: 5,
  },
]

async function main() {
  const operatorKey = await generateOperatorKey()
  const agentKey: AgentKey = {
    publicKey: operatorKey.publicKey,
    privateKey: operatorKey.privateKey,
    delegatedBy: operatorKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
  }

  console.log(`[harvest-github] publishing ${TARGET_ISSUES.length} GitHub issues`)
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
        },
      }

      const unsignedEvent = createEvent('intent.question' as any, payload, issue.tags)
      const signedEvent = await signEvent(unsignedEvent, agentKey)
      const result = await publishEvent(signedEvent, RELAY)

      if (result.ok) {
        console.log(`[harvest-github] ✓ #${issue.number} — ${issue.title.slice(0, 60)}`)
        published++
      } else {
        console.error(`[harvest-github] ✗ #${issue.number} — ${result.error}`)
        failed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[harvest-github] ✗ #${issue.number} — ${msg}`)
      failed++
    }
  }

  console.log(`\n[harvest-github] done — published=${published} failed=${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
