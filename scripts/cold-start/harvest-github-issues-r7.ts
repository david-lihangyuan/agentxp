#!/usr/bin/env npx tsx
// Harvest GitHub issues as cold-start questions — Round 7 (2026-04-14)

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
    number: 66619,
    title: 'Telegram setup crashes with TypeError: Cannot read properties of undefined (reading "trim")',
    body: 'Running `openclaw` Telegram channel setup crashes immediately after the DM policy warning banner with: TypeError: Cannot read properties of undefined (reading "trim"). Steps: 1) Install openclaw latest npm, 2) Run Telegram channel setup wizard, 3) Error throws after DM policy warning. Workaround: roll back to 2026.4.5. Root cause is likely in the Telegram setup wizard prompt handler that reads the user answer after the DM policy step — one of the input fields arrives as undefined (e.g. the answer to a prompt, or a channel id/token read from the wizard state), and the subsequent .trim() call crashes. The undefined value is not validated before use. Environment: OpenClaw 2026.4.14, macOS 26.3.',
    url: 'https://github.com/openclaw/openclaw/issues/66619',
    tags: ['openclaw', 'telegram', 'setup', 'crash', 'bug', 'regression'],
    score: 8
  },
  {
    number: 66618,
    title: 'Scoped npm packages from ClawHub fail to install with ENOENT',
    body: '`openclaw plugins install @scope/name` fails with ENOENT for any scoped (slash-containing) package from ClawHub. Non-scoped packages install fine. Error: ENOENT: no such file or directory, open \'/var/folders/.../openclaw-clawhub-package-XXXXXX/@axonflow/openclaw.zip\'. Root cause: when constructing the temp file path for the downloaded package zip, the code concatenates the package name (e.g. "@axonflow/openclaw") directly into a file system path. The slash in "@axonflow/openclaw" is interpreted as a directory separator, creating a path like ".../XXXXXX/@axonflow/openclaw.zip" where directory "@axonflow" does not exist. Fix: URL-encode or replace slashes in scoped package names when building temp paths (e.g. "@axonflow/openclaw" → "@axonflow_openclaw" or use encodeURIComponent). Environment: all OS, OpenClaw latest.',
    url: 'https://github.com/openclaw/openclaw/issues/66618',
    tags: ['openclaw', 'plugins', 'clawhub', 'scoped-package', 'enoent', 'path', 'bug'],
    score: 8
  },
  {
    number: 66620,
    title: '[Bug]: lossless-claw compaction summaries with Ollama cloud models return empty normalized output',
    body: 'When lossless-claw uses Ollama cloud models for compaction summaries, the summary path returns empty normalized output and silently falls back to truncation. Normal chat with the same models works; delegated expansion can work. This is separate from the "No API provider registered for api: ollama" issue. Affected path: lossless-claw compaction summary generation specifically. The summary model call completes but normalize/parse of the response returns empty. Root cause likely: lossless-claw\'s summary normalization code assumes a response format that Ollama cloud models do not produce (e.g. different streaming format, missing fields in the response object, or a content extraction path that returns undefined for Ollama\'s response schema). The fallback to truncation is silent — no log warning emitted. Environment: OpenClaw 2026.4.5, macOS arm64, @martian-engineering/lossless-claw@0.8.2.',
    url: 'https://github.com/openclaw/openclaw/issues/66620',
    tags: ['openclaw', 'lossless-claw', 'ollama', 'compaction', 'context-engine', 'bug'],
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
        console.log(`[harvest-github-r7] ✓ #${issue.number} — ${issue.title.slice(0, 60)}`)
        published++
      } else {
        console.error(`[harvest-github-r7] ✗ #${issue.number} — ${result.error}`)
        failed++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[harvest-github-r7] ✗ #${issue.number} — ${msg}`)
      failed++
    }
  }

  console.log(`\n[harvest-github-r7] done — published=${published} failed=${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
