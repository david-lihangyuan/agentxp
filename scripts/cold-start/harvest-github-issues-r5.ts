#!/usr/bin/env npx tsx
// Harvest GitHub issues as cold-start questions — Round 5 (2026-04-14)

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
    number: 66514,
    title: '[Bug]: Browser control service reports healthy while CDP/browser path is dead; snapshot/screenshot timeout and start recovery fails on macOS (2026.4.12)',
    body: 'On OpenClaw 2026.4.12 on macOS, the browser control layer reports healthy (running=true, cdpReady=true, cdpHttp=true) while real browser operations (browser snapshot, browser screenshot) timeout consistently. After killing Chrome entirely and restarting the gateway, browser start still times out. Key finding: direct Playwright import succeeds (PW_AI_OK), but internal reachability checks fail: HTTP_REACHABLE=false, CDP_READY=false after restart. Root: browser control service readiness check is not equivalent to real CDP/Playwright path readiness. The isHttpReachable()/isReachable() checks used by the service do not verify the full CDP→Playwright→snapshot path. The service can return "ready" while the actual capture path is unreachable. Relevant path: browser tool → browser control service → ensureBrowserAvailable() → isHttpReachable() + isChromeCdpReady() → snapshot/screenshot via Playwright route handlers. Environment: macOS Darwin 21.6.0 x64, OpenClaw 2026.4.12, npm global install, Chrome at /Applications/Google Chrome, CDP port 18800.',
    url: 'https://github.com/openclaw/openclaw/issues/66514',
    tags: ['openclaw', 'browser', 'cdp', 'playwright', 'macos', 'snapshot', 'bug'],
    score: 8
  },
  {
    number: 66509,
    title: 'Gateway buffers tool-kind text instead of delivering immediately (streaming.mode partial ignored)',
    body: 'When the assistant responds with intermediate text before a tool call (e.g., "Let me check that..."), the text is classified as kind: "tool" by the gateway dispatcher and buffered instead of sent to the user. Only the final kind: "block" response reaches the chat. Users see silence after sending a message with no acknowledgment. Root cause in gateway-DLRO57ZD.js lines 2279-2326: if (info.kind === "tool") { toolTexts.push(toolText); ... return; } — text is pushed to toolTexts[] buffer and never sent. A 60s fallback timeout only fires if NO block arrives within 60s; since block always arrives before 60s, toolTexts are silently discarded. The streaming.mode: "partial" config is not checked in this code path. Fix options: (1) add streaming.toolDelivery: "immediate" config, (2) treat pre-tool-call text as kind: "block", (3) respect streaming.mode: "partial" for tool deliveries. Environment: OpenClaw latest (Docker ghcr.io/hostinger/hvps-openclaw:latest), Telegram/QQBot gateway, Linux VPS.',
    url: 'https://github.com/openclaw/openclaw/issues/66509',
    tags: ['openclaw', 'gateway', 'streaming', 'tool-delivery', 'telegram', 'qqbot', 'bug'],
    score: 7
  },
  {
    number: 66510,
    title: 'Control UI/WebChat: reading indicator disappears during active tool-first runs',
    body: 'In Control UI / WebChat, the visible ... reading/typing indicator disappears during an active run when tool activity begins before the first assistant text token arrives. The Stop button remains visible (run is still active), but the user sees no progress indicator and no partial text. Root cause: the reading indicator is only rendered when stream !== null AND stream has text content. When early tool-call stream events arrive before any assistant text delta, the stream text is empty/null and the indicator is suppressed. The shipped UI bundle still contains the chat-reading-indicator component, CSS for animated dots, active-run state (chatRunId), and tool-stream handling — this is a render-gating bug, not missing assets. Fix: decouple the reading indicator visibility from stream text presence; keep it visible whenever chatRunId is set and no assistant text is streaming yet. Environment: OpenClaw 2026.4.12, Control UI / WebChat.',
    url: 'https://github.com/openclaw/openclaw/issues/66510',
    tags: ['openclaw', 'ui', 'webchat', 'control-ui', 'streaming', 'ux', 'bug'],
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
        console.log(`[harvest-github-r5] ✓ #${issue.number} — ${issue.title.slice(0, 70)}`)
        published++
      } else {
        console.error(`[harvest-github-r5] ✗ #${issue.number} — ${result.error}`)
        failed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[harvest-github-r5] ✗ #${issue.number} — ${msg}`)
      failed++
    }
  }

  console.log(`\n[harvest-github-r5] done — published=${published} failed=${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
