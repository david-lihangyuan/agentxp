// Verifier Bot — fetches pending solutions, executes in sandbox, publishes verification events
//
// Usage: npx tsx scripts/cold-start/verify.ts --relay=https://relay.agentxp.io

import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createEvent, signEvent } from '../../packages/protocol/src/index.js'
import { publishEvent } from './publish.js'
import type { AgentKey } from '../../packages/protocol/src/types.js'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface VerifierConfig {
  relayUrl: string
  operatorKey: { publicKey: string; privateKey: Uint8Array }
}

interface VerifyResult {
  ok: boolean
  passed: boolean
  error?: string
}

interface RunResult {
  passed: number
  failed: number
  errors: number
}

// ─────────────────────────────────────────────────────────────
// Fetch pending solutions from relay
// ─────────────────────────────────────────────────────────────

export async function fetchPendingSolutions(
  relayUrl: string,
  limit?: number,
): Promise<unknown[]> {
  const url = `${relayUrl}/api/cold-start/solutions?status=pending${limit != null ? `&limit=${limit}` : ''}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch solutions: HTTP ${response.status}`)
  }
  const data = (await response.json()) as unknown[]
  return data
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const CODE_BLOCK_RE = /```(?:\w+)?\n([\s\S]*?)```/g
const COMMAND_RE = /(?:npm test|npx\s+\S+|node\s+\S+)/g

interface ExtractedCode {
  filename: string
  content: string
}

/** Extract fenced code blocks from solution text, return files to write. */
function extractCodeBlocks(solutionText: string): ExtractedCode[] {
  const results: ExtractedCode[] = []
  let match: RegExpExecArray | null
  let idx = 0

  const re = /```(\w+)?\n([\s\S]*?)```/g
  while ((match = re.exec(solutionText)) !== null) {
    const lang = match[1] ?? 'txt'
    const content = match[2]
    const ext = lang === 'typescript' || lang === 'ts' ? 'ts'
      : lang === 'javascript' || lang === 'js' ? 'js'
      : lang === 'json' ? 'json'
      : lang === 'python' || lang === 'py' ? 'py'
      : lang
    results.push({ filename: `file_${idx}.${ext}`, content })
    idx++
  }
  return results
}

/** Extract runnable commands from solution text. */
function extractCommands(solutionText: string): string[] {
  const matches = solutionText.match(COMMAND_RE)
  return matches ?? []
}

// ─────────────────────────────────────────────────────────────
// Verify a single solution
// ─────────────────────────────────────────────────────────────

export async function verifySolution(
  solution: Record<string, unknown>,
  config: VerifierConfig,
): Promise<VerifyResult> {
  const eventId = String((solution as Record<string, unknown>).event_id ?? 'unknown')
  const tmpDir = path.join(os.tmpdir(), `agentxp-verify-${eventId.slice(0, 8)}`)

  try {
    // 1. Create temp directory
    fs.mkdirSync(tmpDir, { recursive: true })

    // 2. Extract solution text and code blocks
    const payload = solution.payload as { data?: { solution?: string } } | undefined
    const solutionText = payload?.data?.solution ?? ''
    if (!solutionText) {
      return { ok: true, passed: false, error: 'No solution text found' }
    }

    const codeBlocks = extractCodeBlocks(solutionText)
    for (const block of codeBlocks) {
      fs.writeFileSync(path.join(tmpDir, block.filename), block.content, 'utf-8')
    }

    // 3. Extract and execute verification commands
    const commands = extractCommands(solutionText)
    const commandToRun = commands.length > 0 ? commands[0] : null

    let exitCode = 0
    let stdout = ''
    let stderr = ''

    if (commandToRun) {
      const result = spawnSync(commandToRun, {
        cwd: tmpDir,
        shell: true,
        timeout: 30_000,
        encoding: 'utf-8',
      })
      exitCode = result.status ?? 1
      stdout = result.stdout ?? ''
      stderr = result.stderr ?? ''
    } else if (codeBlocks.length > 0) {
      // If no explicit command, try running the first JS/TS file with node
      const jsFile = codeBlocks.find(
        (b) => b.filename.endsWith('.js') || b.filename.endsWith('.ts'),
      )
      if (jsFile) {
        const result = spawnSync('node', [jsFile.filename], {
          cwd: tmpDir,
          timeout: 30_000,
          encoding: 'utf-8',
        })
        exitCode = result.status ?? 1
        stdout = result.stdout ?? ''
        stderr = result.stderr ?? ''
      }
    }

    // 4. Build agent key from operator key (solo mode)
    const agentKey: AgentKey = {
      publicKey: config.operatorKey.publicKey,
      privateKey: config.operatorKey.privateKey,
      delegatedBy: config.operatorKey.publicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
    }

    const solutionId = eventId
    const passed = exitCode === 0

    // 5. Publish verification event
    if (passed) {
      const verifyPayload = {
        type: 'verification.pass',
        data: {
          solution_id: solutionId,
          output: stdout,
        },
      }
      const unsigned = createEvent('verification.pass', verifyPayload, [])
      const signed = await signEvent(unsigned, agentKey)
      const pub = await publishEvent(signed, config.relayUrl)
      if (!pub.ok) {
        return { ok: false, passed: true, error: `Publish failed: ${pub.error}` }
      }
    } else {
      const verifyPayload = {
        type: 'verification.fail',
        data: {
          solution_id: solutionId,
          step_failed: 'execution',
          error: stderr,
        },
      }
      const unsigned = createEvent('verification.fail', verifyPayload, [])
      const signed = await signEvent(unsigned, agentKey)
      const pub = await publishEvent(signed, config.relayUrl)
      if (!pub.ok) {
        return { ok: false, passed: false, error: `Publish failed: ${pub.error}` }
      }
    }

    return { ok: true, passed }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { ok: false, passed: false, error }
  } finally {
    // 6. Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Run verifier loop
// ─────────────────────────────────────────────────────────────

export async function runVerifier(
  config: VerifierConfig,
  limit?: number,
): Promise<RunResult> {
  const stats: RunResult = { passed: 0, failed: 0, errors: 0 }

  const solutions = await fetchPendingSolutions(config.relayUrl, limit)

  for (const solution of solutions) {
    const result = await verifySolution(solution as Record<string, unknown>, config)
    if (!result.ok) {
      stats.errors++
    } else if (result.passed) {
      stats.passed++
    } else {
      stats.failed++
    }
  }

  return stats
}

// ─────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const relayArg = args.find((a) => a.startsWith('--relay='))
  if (!relayArg) {
    console.error('Usage: npx tsx scripts/cold-start/verify.ts --relay=<url>')
    process.exit(1)
  }
  const relayUrl = relayArg.split('=').slice(1).join('=')

  const limitArg = args.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined

  // In production, load keys from ~/.agentxp/identity/
  // For now, generate ephemeral keys
  const { generateOperatorKey } = await import('../../packages/protocol/src/index.js')
  const operatorKey = await generateOperatorKey()

  const config: VerifierConfig = { relayUrl, operatorKey }

  console.log(`Verifier starting — relay: ${relayUrl}`)
  const stats = await runVerifier(config, limit)
  console.log(`Done — passed: ${stats.passed}, failed: ${stats.failed}, errors: ${stats.errors}`)

  if (stats.errors > 0) {
    process.exit(1)
  }
}

// Only run when executed directly, not when imported by tests
const isDirectRun = process.argv[1]?.endsWith('verify.ts') || process.argv[1]?.endsWith('verify.js')
if (isDirectRun) {
  main().catch((err) => {
    console.error('Verifier failed:', err)
    process.exit(1)
  })
}
