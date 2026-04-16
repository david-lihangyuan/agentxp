#!/usr/bin/env npx tsx
// Harvest GitHub issues as cold-start questions — Round 9 (2026-04-15)

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
    number: 66958,
    title: '[Bug]: Telegram native command menu can be cleared on startup because runtime command registration resolves to an empty list',
    body: 'On OpenClaw 2026.4.14, Telegram native commands appear enabled and supported, but the bot\'s native command menu becomes empty or gets cleared on startup. Config is standard (commands.native="auto", commands.nativeSkills="auto", channels.telegram.enabled=true, Telegram plugin advertises nativeCommandsAutoEnabled=true, built-in command catalog is not empty). Root cause hypothesis: the runtime native-command resolution path sometimes produces an empty commandsToRegister list for Telegram. When commandsToRegister.length === 0, the Telegram sync path calls deleteMyCommands() and caches the empty-list hash (~/.openclaw/telegram/command-hash-*.txt). The bot menu is then cleared and remains missing across restarts until the runtime builds a non-empty list again. Steps to reproduce: 1) Configure Telegram with native commands on auto, 2) Start or restart OpenClaw, 3) Check Telegram bot command menu — it may be empty, 4) Inspect the on-disk hash file and compare with hash of []. Expected: non-empty command menu registers at startup. Actual: deleteMyCommands() is called with an empty list, clearing the menu permanently until next successful registration. Regression in 2026.4.14, macOS, npm install.',
    url: 'https://github.com/openclaw/openclaw/issues/66958',
    tags: ['openclaw', 'telegram', 'native-commands', 'regression', '2026.4.14', 'setMyCommands', 'bug'],
    score: 7
  },
  {
    number: 66957,
    title: '[Bug]: models.mode="replace" still triggers implicit provider discovery and causes large startup delays',
    body: 'With models.mode="replace" and only one explicit provider configured, OpenClaw 2026.4.14 still invokes implicit provider discovery before mode-specific handling, contrary to documented semantics. The config schema documents that replace mode should use only explicitly configured providers. However, in src/agents/models-config.plan.ts:47-58, resolveProvidersForModelsJsonWithDeps() still calls resolveImplicitProviders() before any mode-specific handling. Steps to reproduce: 1) Configure models.mode="replace" with minimal explicit provider set, 2) Compare documented semantics in src/config/schema.help.ts:739-740 with implementation in src/agents/models-config.plan.ts:47-58, 3) Start a minimal legacy embedded-agent run with that config. Expected: only explicitly configured providers used; no implicit discovery; fast startup. Actual: implicit provider discovery still runs; in observed runs on 2026.4.14 meaningful lifecycle start was delayed by ~72 seconds before the embedded agent run proceeded. Environment: OpenClaw 2026.4.14 (a14f7c5c6d), Ubuntu 24.04, source checkout / pnpm tsx, single explicit OpenAI-responses-compatible mock provider.',
    url: 'https://github.com/openclaw/openclaw/issues/66957',
    tags: ['openclaw', 'models', 'provider-discovery', 'startup-delay', 'config', 'bug', '2026.4.14'],
    score: 7
  },
  {
    number: 66714,
    title: '[Bug] Telegram setMyCommands not called on gateway restart in 2026.4.14',
    body: 'After upgrading to OpenClaw 2026.4.14 (323493f), the Telegram bot slash commands disappear after a gateway restart. getMyCommands API returns an empty list. Evidence: earlier restarts in the same day (15:30-15:52 UTC) called setMyCommands successfully (logs show "Telegram menu text exceeded the conservative 5700-character payload budget; shortening descriptions to keep 58 commands visible"). Later restarts (17:09-17:31 UTC) show no setMyCommands call at all — the "starting provider" log appears but menu registration step is completely skipped. API verification: getMyCommands returns {"ok":true,"result":[]} after restart, confirming commands were never set. Workaround: manually calling setMyCommands via Telegram Bot API works and persists until next gateway restart. Root cause hypothesis: registerTelegramNativeCommands function in bot-BwMz6R6-.js is not being called during gateway startup after the 2026.4.14 update. Inconsistency (some restarts work, others skip it) suggests a timing or initialization order issue. Environment: OpenClaw 2026.4.14 (323493f), Linux 6.8.0-101-generic (x64), Node 22.22.1, grammy-based Telegram provider.',
    url: 'https://github.com/openclaw/openclaw/issues/66714',
    tags: ['openclaw', 'telegram', 'setMyCommands', 'native-commands', 'gateway', 'regression', '2026.4.14', 'bug'],
    score: 6
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
        console.log(`[harvest-github-r9] ✓ #${issue.number} — ${issue.title.slice(0, 60)}`)
        published++
      } else {
        console.error(`[harvest-github-r9] ✗ #${issue.number} — ${result.error}`)
        failed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[harvest-github-r9] ✗ #${issue.number} — ${msg}`)
      failed++
    }
  }

  console.log(`\n[harvest-github-r9] done — published=${published} failed=${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
