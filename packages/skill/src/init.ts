// `agentxp init` — seed SKILL.md and the reflections workspace.
// Side-effects are intentionally minimal: copy SKILL.md, create
// .agentxp/ scaffolding, and ensure the operator key exists so the
// host can start drafting immediately.
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureOperatorKey } from './identity.js'

const SKILL_ASSET = (() => {
  // Both `src/init.ts` and `dist/init.js` sit one directory below the
  // package root where SKILL.md lives.
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'SKILL.md')
})()

export interface InitOptions {
  targetDir: string
  identityRoot?: string
  assetPath?: string
}

export interface InitResult {
  skillPath: string
  reflectionsDir: string
  operatorPubkey: string
  created: boolean
}

export async function initWorkspace(opts: InitOptions): Promise<InitResult> {
  const target = opts.targetDir
  mkdirSync(target, { recursive: true })
  const skillPath = join(target, 'SKILL.md')
  const reflectionsDir = join(target, '.agentxp', 'reflections')
  mkdirSync(reflectionsDir, { recursive: true })

  const source = opts.assetPath ?? SKILL_ASSET
  const alreadyPresent = existsSync(skillPath)
  if (!alreadyPresent) {
    copyFileSync(source, skillPath)
  }

  const configPath = join(target, '.agentxp', 'config.json')
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          relay_url: 'http://localhost:3141',
          agent_id: 'default',
        },
        null,
        2,
      ),
    )
  }

  const operator = await ensureOperatorKey(opts.identityRoot)
  return {
    skillPath,
    reflectionsDir,
    operatorPubkey: operator.publicKey,
    created: !alreadyPresent,
  }
}
