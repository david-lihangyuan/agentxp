#!/usr/bin/env npx tsx
// Harvest GitHub issues as cold-start questions — Round 8 (2026-04-15)

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
    number: 66631,
    title: '[Bug] Feishu: Bot replies create new topics instead of replying within existing topic',
    body: 'When a bot replies to messages in Feishu topic groups, it creates new sub-threads instead of replying within the original topic thread. This happens specifically when users send new messages directly in a topic (not replying to other messages). Root cause: Feishu message events return `root_id: null` for new messages in a topic (not a reply). Current OpenClaw logic uses `ctx.rootId ?? ctx.messageId` — when rootId is null, it falls back to current messageId and creates a new sub-thread. Fix: detect topic context via thread_id presence and use thread_id as reply target when root_id is null. Environment: OpenClaw 2026.4.12, Feishu topic groups.',
    url: 'https://github.com/openclaw/openclaw/issues/66631',
    tags: ['openclaw', 'feishu', 'topic', 'reply', 'threading', 'bug'],
    score: 7
  },
  {
    number: 66626,
    title: 'config.get leaks raw secrets via sourceConfig/runtimeConfig paths',
    body: 'The `config.get` tool/command has inconsistent secret redaction across its output paths. While `parsed` and `resolved` paths properly redact sensitive values, the `sourceConfig` and `runtimeConfig` paths return raw unredacted values of all secrets loaded from EnvironmentFile/.env. Security impact: any installed skill, plugin, or LLM turn that calls `config.get` can read all API keys, tokens, and secrets in plaintext via `sourceConfig` or `runtimeConfig`. A malicious skill or prompt injection attack could exfiltrate credentials. Steps to reproduce: 1) Configure OpenClaw with secrets in .env, 2) Call config.get and inspect sourceConfig/runtimeConfig paths, 3) Observe plaintext secrets. Fix: apply same redaction logic used for parsed/resolved to all output paths. Environment: OpenClaw 2026.4.14, all OS.',
    url: 'https://github.com/openclaw/openclaw/issues/66626',
    tags: ['openclaw', 'config', 'security', 'secret-leak', 'credentials', 'bug'],
    score: 9
  },
  {
    number: 66625,
    title: 'image tool fails with Minimax VLM model (minimax-cn/Minimax-M2.7)',
    body: 'The `image` tool in OpenClaw consistently fails when configured with a Minimax vision model (`minimax-cn/Minimax-M2.7`). Tool returns Chinese error text (~44 tokens) instead of image description (~8000 tokens). Direct API calls work correctly. Root cause: `describeImageWithModel()` → `minimaxUnderstandImage()` path fails — likely the provider/model ref normalization before media-tool registry lookup does not handle Minimax variants. Similar to fixed issue #59943 (Ollama vision normalization). Environment: OpenClaw 2026.4.14, minimax-cn/Minimax-M2.7, Feishu DM channel.',
    url: 'https://github.com/openclaw/openclaw/issues/66625',
    tags: ['openclaw', 'image-tool', 'minimax', 'vision', 'vlm', 'bug'],
    score: 7
  },
  {
    number: 66588,
    title: '[Bug]: Browser plugin fails to launch on Raspberry Pi 5 (ARM) — falls back to web_fetch despite Chromium/Playwright working',
    body: 'OpenClaw browser plugin consistently fails to launch on Raspberry Pi 5 (Raspberry Pi OS Lite 64-bit, Debian Trixie arm64). Instead of launching headless Chromium, OpenClaw falls back to web_fetch with "browser isn\'t available". Both Chromium and Playwright work correctly outside OpenClaw. Root cause likely: browser process detection logic assumes browser was launched by OpenClaw (not pre-launched), or ARM-specific binary discovery path fails to find Chromium. Steps: 1) Install OpenClaw on RPi 5, 2) Enable browser plugin, 3) Run any web-browsing command. Expected: headless Chromium launches via browser tool. Actual: silent failure, fallback to web_fetch. Environment: OpenClaw 2026.4.12, Raspberry Pi 5, Debian Trixie arm64.',
    url: 'https://github.com/openclaw/openclaw/issues/66588',
    tags: ['openclaw', 'browser', 'arm64', 'raspberry-pi', 'playwright', 'bug'],
    score: 7
  },
  {
    number: 66507,
    title: '[Bug] WeChat and Feishu channels share the same session instead of creating separate sessions',
    body: 'WeChat and Feishu channels share the same session (agent:main:main) instead of creating separate sessions. When messages come from different channels, they are all routed to the same session. Steps: 1) Configure both Feishu and WeChat (openclaw-weixin) channels, 2) Send messages from each channel, 3) Check sessions via /sessions_list. Expected: WeChat → session agent:main:weixin, Feishu → session agent:main:feishu, independent sessions per channel. Actual: Only one session agent:main:main; both channels converge. Root cause: channel session key derivation does not differentiate between WeChat and Feishu plugins — both resolve to the same key. Environment: OpenClaw 2026.4.12, WeChat + Feishu dual-channel setup.',
    url: 'https://github.com/openclaw/openclaw/issues/66507',
    tags: ['openclaw', 'wechat', 'feishu', 'session', 'channel', 'multi-channel', 'bug'],
    score: 8
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
        console.log(`[harvest-github-r8] ✓ #${issue.number} — ${issue.title.slice(0, 60)}`)
        published++
      } else {
        console.error(`[harvest-github-r8] ✗ #${issue.number} — ${result.error}`)
        failed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[harvest-github-r8] ✗ #${issue.number} — ${msg}`)
      failed++
    }
  }

  console.log(`\n[harvest-github-r8] done — published=${published} failed=${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
