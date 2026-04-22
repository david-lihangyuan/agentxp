// Load an AgentKey from disk. Two on-disk layouts are supported:
//
//   1. Split layout (produced when an operator manually provisions an
//      agent sub-key): `agentKeyPath` points at a 64-char-hex file
//      holding only the 32-byte Ed25519 seed; a sibling `agent.json`
//      in the same directory holds { publicKey, delegatedBy,
//      expiresAt, agentId } WITHOUT the private key.
//
//   2. Skill layout (produced by @agentxp/skill ensureAgentKey): the
//      `agentKeyPath` target itself is JSON containing
//      { publicKey, privateKey, delegatedBy, expiresAt, agentId }.
//      This form is accepted for compatibility; the path may point at
//      a file named `agent.json` in that case.
//
// Either way we must end up with a valid @agentxp/protocol AgentKey
// whose `delegatedBy` matches the configured operator public key.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { hexToBytes } from '@agentxp/protocol'
import type { AgentKey } from '@agentxp/protocol'

const HEX_64 = /^[0-9a-f]{64}$/i

export class AgentKeyLoadError extends Error {
  constructor(message: string) {
    super(`agentxp plugin: ${message}`)
    this.name = 'AgentKeyLoadError'
  }
}

interface AgentJsonFields {
  publicKey: string
  delegatedBy: string
  expiresAt: number
  agentId?: string
  privateKey?: string
}

function parseAgentJson(path: string): AgentJsonFields {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new AgentKeyLoadError(
      `failed to parse ${path} as JSON (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (!raw || typeof raw !== 'object') {
    throw new AgentKeyLoadError(`${path} is not a JSON object`)
  }
  const obj = raw as Record<string, unknown>
  const pick = (k: string): string | undefined =>
    typeof obj[k] === 'string' ? (obj[k] as string) : undefined
  const publicKey = pick('publicKey')
  const delegatedBy = pick('delegatedBy')
  const expiresAt = typeof obj.expiresAt === 'number' ? obj.expiresAt : undefined
  if (!publicKey || !delegatedBy || typeof expiresAt !== 'number') {
    throw new AgentKeyLoadError(`${path} is missing one of: publicKey, delegatedBy, expiresAt`)
  }
  const result: AgentJsonFields = { publicKey, delegatedBy, expiresAt }
  const privateKey = pick('privateKey')
  if (privateKey) result.privateKey = privateKey
  const agentId = pick('agentId')
  if (agentId) result.agentId = agentId
  return result
}

export function loadAgentKey(agentKeyPath: string, operatorPublicKey: string): AgentKey {
  if (!existsSync(agentKeyPath)) {
    throw new AgentKeyLoadError(
      `agentKeyPath not found: ${agentKeyPath} (run the skill init flow or ` +
        `provision an agent sub-key manually).`,
    )
  }

  const raw = readFileSync(agentKeyPath, 'utf8').trim()
  let privateKeyHex: string
  let metaPath: string

  if (raw.length > 0 && (raw.startsWith('{') || raw.startsWith('['))) {
    // Skill layout: the agentKeyPath is the metadata file itself.
    const meta = parseAgentJson(agentKeyPath)
    if (!meta.privateKey) {
      throw new AgentKeyLoadError(
        `${agentKeyPath} is a JSON metadata file but has no privateKey field; ` +
          `provide agent.key (split layout) or include privateKey (skill layout).`,
      )
    }
    privateKeyHex = meta.privateKey
    return assembleAgentKey(privateKeyHex, meta, operatorPublicKey, agentKeyPath)
  }

  // Split layout: the file is a single hex seed; the metadata lives in
  // the sibling agent.json.
  privateKeyHex = raw
  metaPath = join(dirname(agentKeyPath), 'agent.json')
  if (!existsSync(metaPath)) {
    throw new AgentKeyLoadError(
      `agentKeyPath is a hex seed but sibling metadata file is missing: ${metaPath}`,
    )
  }
  const meta = parseAgentJson(metaPath)
  return assembleAgentKey(privateKeyHex, meta, operatorPublicKey, agentKeyPath)
}

function assembleAgentKey(
  privateKeyHex: string,
  meta: AgentJsonFields,
  operatorPublicKey: string,
  sourcePath: string,
): AgentKey {
  if (!HEX_64.test(privateKeyHex)) {
    throw new AgentKeyLoadError(
      `${sourcePath}: privateKey must be 64 lowercase hex characters (32-byte Ed25519 seed)`,
    )
  }
  if (!HEX_64.test(meta.publicKey)) {
    throw new AgentKeyLoadError(`${sourcePath}: publicKey must be 64 lowercase hex characters`)
  }
  if (meta.delegatedBy.toLowerCase() !== operatorPublicKey.toLowerCase()) {
    throw new AgentKeyLoadError(
      `delegatedBy mismatch: agent.delegatedBy=${meta.delegatedBy} but ` +
        `plugin config operatorPublicKey=${operatorPublicKey}. Re-delegate ` +
        `the agent key, or update the config to the matching operator.`,
    )
  }
  const key: AgentKey = {
    publicKey: meta.publicKey.toLowerCase(),
    privateKey: hexToBytes(privateKeyHex.toLowerCase()),
    delegatedBy: meta.delegatedBy.toLowerCase(),
    expiresAt: meta.expiresAt,
  }
  if (meta.agentId) {
    return { ...key, agentId: meta.agentId }
  }
  return key
}
