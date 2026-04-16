#!/usr/bin/env npx tsx
// Harvest GitHub issues as cold-start questions (for openclaw/openclaw)

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
}

const TARGET_ISSUES: GHIssue[] = [
  {
    number: 67135,
    title: "[Bug]: Webchat context meter shows false overflow after /new — totalTokens includes cacheRead, inflating context %",
    body: "In the dashboard webchat, context usage percentage is computed using totalTokens (inputTokens + outputTokens + cacheRead) against contextTokens. This falsely inflates the percentage because cacheRead does not consume model context window space. Example: gpt-5.4 has contextTokens=200000, inputTokens=173989, cacheRead=110720, totalTokens=284709 — displayed as 142% overflow on a fresh /new session. Expected: context % should be computed from inputTokens only. Additionally, /new sessions start with unexpectedly large prompt footprint (173989 inputTokens on first turn), suggesting compaction data or system context may be leaking across session boundaries. Likely fix locations: dist/sessions-D2FdehhF.js and dist/status.summary-C9oc9pQq.js, where context pct appears to be computed as Math.round(resolveFreshSessionTotalTokens(entry) / contextTokens * 100). Fix: use inputTokens (not totalTokens) as the numerator for context % calculations.",
    url: 'https://github.com/openclaw/openclaw/issues/67135',
    tags: ['openclaw', 'webchat', 'context-meter', 'cache-tokens', 'bug', 'dashboard']
  },
  {
    number: 67133,
    title: "[Bug]: Cron execution history missing lastRunAtMs; internal hooks (heartbeat, self-improvement) never trigger despite being enabled",
    body: "Two related bugs: (1) Cron jobs execute successfully (evidence: report files generated, DB updated) but lastRunAtMs field is never recorded. The cron list displays 'never executed' for all 32 tasks, misleading users into thinking tasks are broken. (2) Internal hooks self-improvement and heartbeat are enabled (hooks.internal.entries.self-improvement: enabled: true, hooks.internal.entries.heartbeat: enabled: true), gateway has run for 145+ minutes (far beyond heartbeat's 30-minute interval), but heartbeat-state.md still shows 'never'. Neither hook fires. Root cause likely: lastRunAtMs write path missing or silent failure in cron execution tracking; internal hook scheduler not initializing or not persisting state correctly after gateway start. High severity: affects all agents running cron tasks and self-improvement loops.",
    url: 'https://github.com/openclaw/openclaw/issues/67133',
    tags: ['openclaw', 'cron', 'hooks', 'heartbeat', 'self-improvement', 'bug', 'lastRunAtMs']
  },
  {
    number: 67109,
    title: "Control UI / Webchat does not render inbound images — session.message contains valid MediaPath but frontend ignores it",
    body: "Images sent via webchat are successfully received and persisted by the backend (confirmed in session.message WebSocket events with mediaPath and mediaPaths fields populated), but the Control UI / Webchat frontend does not render them. Only text is shown. Outbound chat.send correctly includes the image attachment (base64 content confirmed in WS frames). The bug is in the frontend field mapping: session.message events carry image data in mediaPath/mediaPaths but the webchat message renderer does not consume these fields. Chromium and Edge both fail to render; this is not browser-specific. The backend transport and persistence are working correctly — this is purely a frontend rendering/field-mapping gap.",
    url: 'https://github.com/openclaw/openclaw/issues/67109',
    tags: ['openclaw', 'webchat', 'control-ui', 'image-rendering', 'frontend', 'bug', 'mediaPath']
  },
  {
    number: 67113,
    title: "[Bug]: QMD on ARM (Pi 5): embedTimeoutMs only applies to boot embed — interval embeds hardcoded 120s; embedInterval:0 has no effect",
    body: "Three related QMD bugs on ARM (Pi 5): (1) embedTimeoutMs config only applies to boot embed. Interval embeds use a hardcoded 120s timeout with no config override, causing every periodic cycle to time out on ARM where node-llama-cpp attempts to compile llama.cpp with Vulkan (Pi has no Vulkan libs, cmake fails and eats the full 120s). (2) embedInterval: '0' is documented as a way to stop the periodic embed loop, but it is not working — the loop continues regardless. (3) QMD runs embed cycles even when searchMode: 'search' (BM25-only), where vector embeddings are unused — unnecessary overhead. Root cause layer 1 (OpenClaw): interval embed timeout not configurable, embedInterval:0 not respected. Root cause layer 2 (upstream): NODE_LLAMA_CPP_GPU=false doesn't prevent compile-time Vulkan detection. Workaround: set gpu: false in QMD config (prevents Vulkan compile attempt).",
    url: 'https://github.com/openclaw/openclaw/issues/67113',
    tags: ['openclaw', 'qmd', 'arm', 'embed', 'timeout', 'bug', 'raspberry-pi', 'llama-cpp']
  },
  {
    number: 67106,
    title: "Control UI: Pre-tool-call text disappears in Safari when tool results arrive — Chromium works correctly",
    body: "In Safari, text written by the agent before a tool call disappears from the webchat UI when the tool result arrives. Only text after the tool call remains visible. Edge/Chromium renders both pre- and post-tool-call text correctly. The tool call and tool output blocks are also visible in Chromium but hidden in Safari. This suggests Safari handles WebSocket message updates differently during streaming/replacement cycles — possibly related to how the frontend reconciles streaming partial content with arriving tool result events, causing the pre-tool-call text node to be removed or replaced incorrectly. Affects OpenClaw 2026.4.14 in local WebSocket mode.",
    url: 'https://github.com/openclaw/openclaw/issues/67106',
    tags: ['openclaw', 'webchat', 'control-ui', 'safari', 'streaming', 'bug', 'tool-call', 'rendering']
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
          score: 5
        }
      }

      const unsigned = createEvent('intent.question', payload, issue.tags)
      const signed = await signEvent(unsigned, agentKey)

      const res = await publishEvent(signed, RELAY)
      if (res.ok) {
        console.log(`✅ Published GH#${issue.number}: ${issue.title}`)
        published++
      } else {
        console.error(`❌ Failed to publish GH#${issue.number}: ${await res.text()}`)
        failed++
      }
    } catch (err) {
      console.error(`❌ Error publishing GH#${issue.number}:`, err)
      failed++
    }
  }

  console.log(`\nHarvest complete: ${published} published, ${failed} failed.`)
}

main().catch(console.error)
