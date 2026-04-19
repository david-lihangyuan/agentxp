#!/usr/bin/env node
/**
 * init-curiosity.ts
 * Seeds a CURIOSITY.md file with a root question.
 *
 * Usage: npx tsx agents/scripts/init-curiosity.ts \
 *   --root "How do different Agent frameworks handle error recovery?" \
 *   --output agents/coding-01/CURIOSITY.md
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'

export interface CuriosityInit {
  rootQuestion: string
  outputPath: string
  force?: boolean
}

export function generateCuriosityContent(rootQuestion: string): string {
  const timestamp = new Date().toISOString().split('T')[0]
  return `# CURIOSITY.md — Active Exploration State

> ACTIVE ONLY. Keep this file under 300 tokens.
> When a branch is complete, move it to CURIOSITY-ARCHIVE.md immediately.
> Only the current branch lives here.

---

## Root question

${rootQuestion}

---

## Active Branch

\`\`\`
Root question: ${rootQuestion}
  └── Layer 1: [Not yet explored — start here]
        └── ...
\`\`\`

---

## Network signals

- _(No signals yet — will update after first heartbeat)_

---

## Next action

Start at Layer 1: decompose the root question into 2-3 concrete sub-questions.

---

_Initialized: ${timestamp}_
_Active section ends here. Archive completed branches to CURIOSITY-ARCHIVE.md_
`
}

export function initCuriosity(options: CuriosityInit): void {
  const { rootQuestion, outputPath, force = false } = options

  if (!rootQuestion || rootQuestion.trim() === '') {
    throw new Error('Root question cannot be empty')
  }

  const absPath = resolve(outputPath)
  const dir = dirname(absPath)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  if (existsSync(absPath) && !force) {
    throw new Error(
      `CURIOSITY.md already exists at ${absPath}. Use --force to overwrite.`
    )
  }

  const content = generateCuriosityContent(rootQuestion)
  writeFileSync(absPath, content, 'utf8')
  console.log(`Initialized CURIOSITY.md at ${absPath}`)
  console.log(`Root question: "${rootQuestion}"`)
}

export function validateCuriosityContent(content: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!content.includes('Root question')) {
    errors.push('Missing "Root question" section')
  }

  if (!content.includes('Active Branch') && !content.includes('Active section')) {
    errors.push('Missing active branch section')
  }

  if (!content.includes('Network signals')) {
    errors.push('Missing "Network signals" section')
  }

  // Rough token estimate: ~4 chars per token
  const activeSection = extractActiveSection(content)
  const estimatedTokens = estimateTokens(activeSection)
  if (estimatedTokens >= 300) {
    errors.push(`Active section too large: ~${estimatedTokens} tokens (limit: 300)`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function extractActiveSection(content: string): string {
  // Extract everything up to the archive marker
  const archiveMarker = 'Archive completed branches'
  const idx = content.indexOf(archiveMarker)
  if (idx !== -1) {
    return content.substring(0, idx)
  }
  return content
}

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4)
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith('init-curiosity.ts')) {
  const args = process.argv.slice(2)

  let rootQuestion = ''
  let outputPath = ''
  let force = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      rootQuestion = args[++i]
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i]
    } else if (args[i] === '--force') {
      force = true
    }
  }

  if (!rootQuestion || !outputPath) {
    console.error('Usage: init-curiosity.ts --root "<question>" --output <path>')
    process.exit(1)
  }

  try {
    initCuriosity({ rootQuestion, outputPath, force })
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}
