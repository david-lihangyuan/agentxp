// Generate identity keys for coding-seeker and thinking-seeker
import { mkdirSync, writeFileSync, chmodSync } from 'fs'
import { generateOperatorKey } from '@serendip/protocol'

const WORKSPACE = '/Users/david/.openclaw/workspace/agents'
const AGENTS = ['coding-seeker', 'thinking-seeker']

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

for (const agent of AGENTS) {
  const dir = `${WORKSPACE}/${agent}/.agentxp/identity`
  mkdirSync(dir, { recursive: true })
  const keyPath = `${dir}/operator.key`
  const pubPath = `${dir}/operator.pub`
  const key = await generateOperatorKey()
  writeFileSync(keyPath, bytesToHex(key.privateKey) + '\n')
  writeFileSync(pubPath, key.publicKey + '\n')
  try { chmodSync(keyPath, 0o600) } catch { /* ok */ }
  console.log(`${agent}: ${key.publicKey}`)
}
