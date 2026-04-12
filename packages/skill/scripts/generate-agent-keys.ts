// One-shot script: generate independent Ed25519 keys for each agent instance.
// Usage: npx tsx scripts/generate-agent-keys.ts
import { mkdirSync, writeFileSync, existsSync, chmodSync, readFileSync } from 'fs'
import { join } from 'path'
import { generateOperatorKey } from '@serendip/protocol'

const WORKSPACE = '/Users/david/.openclaw/workspace/agents'
const AGENTS = ['coding-01', 'coding-02', 'thinking-01', 'thinking-02']

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

for (const agent of AGENTS) {
  const identityDir = join(WORKSPACE, agent, '.agentxp', 'identity')
  const keyPath = join(identityDir, 'operator.key')
  const pubPath = join(identityDir, 'operator.pub')

  if (existsSync(keyPath) && existsSync(pubPath)) {
    const pub = readFileSync(pubPath, 'utf8').trim()
    console.log(`${agent}: already has keys (pubkey: ${pub.slice(0, 12)}...)`)
    continue
  }

  mkdirSync(identityDir, { recursive: true })
  const key = await generateOperatorKey()
  writeFileSync(keyPath, bytesToHex(key.privateKey) + '\n')
  writeFileSync(pubPath, key.publicKey + '\n')
  try { chmodSync(keyPath, 0o600); chmodSync(pubPath, 0o600) } catch { /* windows */ }
  console.log(`${agent}: ✅ generated (pubkey: ${key.publicKey.slice(0, 12)}...)`)
}
