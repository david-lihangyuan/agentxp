#!/usr/bin/env node
// Thin CLI dispatcher for @agentxp/skill. Errors are surfaced as
// readable messages, never stack traces (SPEC 03-modules-product §3).
import { initWorkspace } from './init.js'
import { reflect, captureInSessionDraft, openStoreForTarget } from './reflect.js'
import { OperatorKeyMissingError } from './identity.js'
import { DraftValidationError } from './reflect.js'

type Argv = readonly string[]

function getFlag(argv: Argv, name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined
}

function hasFlag(argv: Argv, name: string): boolean {
  return argv.includes(name)
}

function usage(): string {
  return [
    'Usage:',
    '  agentxp init [--dir <path>]',
    '  agentxp reflect [--dir <path>]',
    '  agentxp capture --what <s> --tried <s> --outcome <o> --learned <s> [--tier in-session|end-of-session] [--tag <t>]...',
  ].join('\n')
}

export async function runCli(argv: Argv): Promise<number> {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(usage())
    return cmd ? 0 : 1
  }

  try {
    if (cmd === 'init') {
      const dir = getFlag(rest, '--dir') ?? process.cwd()
      const result = await initWorkspace({ targetDir: dir })
      console.log(
        result.created
          ? `skill installed: ${result.skillPath}`
          : `skill already present: ${result.skillPath}`,
      )
      console.log(`operator pubkey: ${result.operatorPubkey}`)
      return 0
    }

    if (cmd === 'reflect') {
      const dir = getFlag(rest, '--dir') ?? process.cwd()
      const outcome = await reflect({ targetDir: dir })
      console.log(
        `published=${outcome.published.length} retry=${outcome.retry.length} rejected=${outcome.rejected.length}`,
      )
      for (const r of outcome.published) console.log(`  ok event_id=${r.eventId}`)
      for (const r of outcome.rejected)
        console.log(`  rejected draft=${r.draftId} ${r.error ?? ''}`)
      for (const r of outcome.retry) console.log(`  retry draft=${r.draftId} ${r.error ?? ''}`)
      return outcome.rejected.length > 0 ? 2 : 0
    }

    if (cmd === 'capture') {
      const dir = getFlag(rest, '--dir') ?? process.cwd()
      const tier = (getFlag(rest, '--tier') ?? 'in-session') as 'in-session' | 'end-of-session'
      const what = getFlag(rest, '--what') ?? ''
      const tried = getFlag(rest, '--tried') ?? ''
      const outcome = (getFlag(rest, '--outcome') ?? '') as
        | 'succeeded'
        | 'failed'
        | 'partial'
        | 'inconclusive'
      const learned = getFlag(rest, '--learned') ?? ''
      const tags: string[] = []
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--tag' && i + 1 < rest.length) {
          const t = rest[i + 1]
          if (t !== undefined) tags.push(t)
        }
      }
      const store = openStoreForTarget(dir)
      try {
        const row =
          tier === 'end-of-session'
            ? (await import('./reflect.js')).captureEndOfSessionDraft(store, {
                what,
                tried,
                outcome,
                learned,
                tags,
              })
            : captureInSessionDraft(store, { what, tried, outcome, learned, tags })
        console.log(`captured draft=${row.id} tier=${row.tier}`)
        return 0
      } finally {
        store.close()
      }
    }

    console.error(`unknown command: ${cmd}`)
    console.error(usage())
    return 1
  } catch (err) {
    if (err instanceof OperatorKeyMissingError) {
      console.error(`error: ${err.message}`)
      return 1
    }
    if (err instanceof DraftValidationError) {
      console.error(`error: ${err.message} (field: ${err.field})`)
      return 1
    }
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  // quiet unused-var warning for optional flag helper
  void hasFlag
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  const url = new URL(`file://${entry}`).href
  return import.meta.url === url
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    },
  )
}
