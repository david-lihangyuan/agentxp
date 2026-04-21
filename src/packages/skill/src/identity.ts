// Local identity material for the Skill CLI.
// Operator key is the human-held master; an agent key is delegated on
// first use. SPEC 03-modules-product §3: private key bytes MUST NOT
// appear in any outgoing request; they live under ~/.agentxp/identity/.
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  delegateAgentKey,
  generateOperatorKey,
  bytesToHex,
  hexToBytes,
} from '@agentxp/protocol'
import type { AgentKey, OperatorKey } from '@agentxp/protocol'

function defaultRoot(): string {
  return join(homedir(), '.agentxp', 'identity')
}

export class OperatorKeyMissingError extends Error {
  constructor(path: string) {
    super(`operator key not found at ${path}`)
    this.name = 'OperatorKeyMissingError'
  }
}

export interface IdentityPaths {
  root: string
  operatorFile: string
  agentFile: string
}

export function resolveIdentityPaths(root?: string): IdentityPaths {
  const r = root ?? defaultRoot()
  return {
    root: r,
    operatorFile: join(r, 'operator.json'),
    agentFile: join(r, 'agent.json'),
  }
}

interface OperatorOnDisk {
  publicKey: string
  privateKey: string
  created_at: number
}

interface AgentOnDisk {
  publicKey: string
  privateKey: string
  delegatedBy: string
  expiresAt: number
  agentId: string
}

function writePrivate(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // best-effort on platforms without chmod
  }
}

export async function ensureOperatorKey(root?: string): Promise<OperatorKey> {
  const paths = resolveIdentityPaths(root)
  mkdirSync(paths.root, { recursive: true, mode: 0o700 })
  if (existsSync(paths.operatorFile)) {
    const raw = JSON.parse(readFileSync(paths.operatorFile, 'utf8')) as OperatorOnDisk
    return { publicKey: raw.publicKey, privateKey: hexToBytes(raw.privateKey) }
  }
  const op = await generateOperatorKey()
  const record: OperatorOnDisk = {
    publicKey: op.publicKey,
    privateKey: bytesToHex(op.privateKey),
    created_at: Math.floor(Date.now() / 1000),
  }
  writePrivate(paths.operatorFile, record)
  return op
}

export function loadOperatorKey(root?: string): OperatorKey {
  const paths = resolveIdentityPaths(root)
  if (!existsSync(paths.operatorFile)) {
    throw new OperatorKeyMissingError(paths.operatorFile)
  }
  const raw = JSON.parse(readFileSync(paths.operatorFile, 'utf8')) as OperatorOnDisk
  return { publicKey: raw.publicKey, privateKey: hexToBytes(raw.privateKey) }
}

export async function ensureAgentKey(
  operator: OperatorKey,
  agentId: string,
  ttlDays: number,
  root?: string,
): Promise<AgentKey> {
  const paths = resolveIdentityPaths(root)
  mkdirSync(paths.root, { recursive: true, mode: 0o700 })
  if (existsSync(paths.agentFile)) {
    const raw = JSON.parse(readFileSync(paths.agentFile, 'utf8')) as AgentOnDisk
    if (raw.expiresAt > Math.floor(Date.now() / 1000) + 3600) {
      return {
        publicKey: raw.publicKey,
        privateKey: hexToBytes(raw.privateKey),
        delegatedBy: raw.delegatedBy,
        expiresAt: raw.expiresAt,
        agentId: raw.agentId,
      }
    }
  }
  const agent = await delegateAgentKey(operator, agentId, ttlDays)
  const record: AgentOnDisk = {
    publicKey: agent.publicKey,
    privateKey: bytesToHex(agent.privateKey),
    delegatedBy: agent.delegatedBy,
    expiresAt: agent.expiresAt,
    agentId: agent.agentId ?? agentId,
  }
  writePrivate(paths.agentFile, record)
  return { ...agent, agentId: agent.agentId ?? agentId }
}
