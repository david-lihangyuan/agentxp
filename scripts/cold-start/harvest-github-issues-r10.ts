#!/usr/bin/env bun
// Harvest GitHub issues as cold-start questions — Round 10 (2026-04-15)

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
    number: 67057,
    title: 'dreaming-narrative sessions accumulate unbounded, blocking Telegram with 5-minute+ delays',
    body: 'After running OpenClaw for several days, dreaming-narrative sessions accumulate without cleanup. Reported: 77 out of 94 active sessions were dreaming-narrative (82%), causing 5-minute+ Telegram response delays and complete communication blockage. Load avg reached 45-54. Root cause: no session-count cap or TTL for dreaming-narrative sessions; sessions.json grows to 4.5MB+. The message queue for normal user sessions must compete with dreaming sessions for processing slots. Reproduction: run OpenClaw for 3+ days with dreaming enabled; session count reaches 70+ and delays begin, 90+ causes complete blockage. Fix: add session auto-cleanup for dreaming-narrative sessions (TTL or count cap), add priority separation so user messages preempt dreaming, add configurable max concurrent dreaming sessions.',
    url: 'https://github.com/openclaw/openclaw/issues/67057',
    tags: ['openclaw', 'dreaming', 'session-accumulation', 'telegram', 'performance', 'bug', 'high-priority'],
    score: 9,
  },
  {
    number: 67060,
    title: 'Provider requests ignore env proxy by default — silent timeout in WSL / corporate proxy environments',
    body: 'In proxy-required environments (WSL+Clash/Mihomo, corporate networks), OpenClaw provider requests do not automatically use HTTP_PROXY/HTTPS_PROXY environment variables. Failure mode: gateway starts successfully, UI loads normally, chat requests silently timeout with no diagnostic output pointing to proxy as root cause. Even when env proxy vars are correctly set, systemd services inherit them, and curl works — provider requests still bypass the proxy unless explicitly configured via models.providers.<provider>.request.proxy.mode = "env-proxy". Proposal: emit a startup warning when HTTP_PROXY/HTTPS_PROXY is detected but provider proxy is not configured and provider is remote. The warning should be non-breaking (no default behavior change) to avoid routing local/LAN providers through proxy unintentionally.',
    url: 'https://github.com/openclaw/openclaw/issues/67060',
    tags: ['openclaw', 'proxy', 'wsl', 'provider', 'timeout', 'ux', 'feature', 'env-proxy'],
    score: 7,
  },
  {
    number: 67053,
    title: 'TUI streaming indicator stays active 30-120+ seconds after response content finishes',
    body: 'OpenClaw TUI shows streaming/active status indicator for 30-120+ seconds after the last response token is delivered. Users cannot tell when the response is complete. Root cause: there is no content-complete signal separate from the lifecycle-end event. Post-run work (session persistence, delivery cleanup, context compaction) extends the visible streaming state well beyond content delivery. Affected: OpenClaw v2026.4.9+, Ubuntu 24.04.4, Claude Opus 4.6, openclaw tui. Proposed fix: emit a content-complete signal when last delta arrives so TUI can show "finishing" state, separate from full lifecycle completion.',
    url: 'https://github.com/openclaw/openclaw/issues/67053',
    tags: ['openclaw', 'tui', 'streaming', 'ux', 'indicator', 'bug', 'chat'],
    score: 6,
  },
  {
    number: 67065,
    title: 'Plugin API gap: no session-scoped next-turn suppression for managed media workflows',
    body: 'After a managed-hook workflow (e.g., visual ingestion) sends a clarifier to the user via before_agent_reply, the next user reply immediately re-enters the normal session path — stock pre-reply plugins (active-memory, etc.) run again, the main run starts again. There is no supported way for a plugin to claim the next turn inside the same managed workflow. The gap was exposed after the #66910 media-hook fix: workflows that ask clarifiers now see the follow-up reply escape into normal session routing. Reproduction: write a plugin that claims a Telegram image turn in before_agent_reply, sends a clarifier, then observe the user\'s reply — it enters a new before_agent_reply cycle with no memory of the pending workflow. Fix: add a session-scoped pending-workflow state API that before_agent_reply hooks can set to suppress stock pre-reply handling on the next turn and route it back to the claiming plugin.',
    url: 'https://github.com/openclaw/openclaw/issues/67065',
    tags: ['openclaw', 'plugin-api', 'before_agent_reply', 'media', 'managed-workflow', 'session-state', 'feature'],
    score: 7,
  },
  {
    number: 67042,
    title: '[BUG] view_image tool returns local file path instead of Base64 data URI for local llama.cpp models',
    body: 'The view_image built-in tool breaks multimodal functionality when using local llama.cpp-based models (llama-server, Ollama, etc.). Root cause: view_image returns a local file path as a URL source (type: "url", url: "/path/to/image.jpg"), but llama.cpp servers cannot fetch local file paths — they require Base64 data URIs. Cloud providers (ModelScope, OpenAI) work because they receive actual URLs. Fix: when the resolved path is a local file, read it and return as Base64 data URI (data:image/<mime>;base64,...) instead of a file URL. The server error from receiving a non-fetchable local path also accumulates in agent context causing severe slowdown. Environment: local Qwen3VL model on llama-server, Windows/macOS.',
    url: 'https://github.com/openclaw/openclaw/issues/67042',
    tags: ['openclaw', 'view_image', 'multimodal', 'llama.cpp', 'base64', 'local-model', 'bug'],
    score: 8,
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
        console.log(`[harvest-github-r10] ✓ #${issue.number} — ${issue.title.slice(0, 60)}`)
        published++
      } else {
        console.error(`[harvest-github-r10] ✗ #${issue.number} — ${result.error}`)
        failed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[harvest-github-r10] ✗ #${issue.number} — ${msg}`)
      failed++
    }
  }

  console.log(`\n[harvest-github-r10] done — published=${published} failed=${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
