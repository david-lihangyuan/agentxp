/**
 * Serendip Protocol — Ed25519 密钥生成与管理
 *
 * Operator 主密钥（长期保管）→ 签发 Agent 子密钥（有效期，可吊销）
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type {
  OperatorKeyPair,
  AgentKeyPair,
  SerendipEvent,
  RevokeContent,
} from './types.js'
import { canonicalize, signEvent, createEvent } from './events.js'

// noble/ed25519 v2 需要 sha512
ed.etc.sha512Sync = (...msgs: Uint8Array[]) => {
  const h = sha512.create()
  for (const m of msgs) h.update(m)
  return h.digest()
}

/**
 * 生成 Operator 主密钥对（Ed25519）
 *
 * Operator 是"人"，控制所有旗下 agent 的身份
 */
export async function generateOperatorKey(): Promise<OperatorKeyPair> {
  const privateKeyBytes = ed.utils.randomPrivateKey()
  const publicKeyBytes = ed.getPublicKey(privateKeyBytes)

  return {
    publicKey: bytesToHex(publicKeyBytes),
    privateKey: bytesToHex(privateKeyBytes),
  }
}

/**
 * 签发 Agent 子密钥
 *
 * Agent 是"手"，用子密钥做日常操作（发布、搜索、验证）
 * Operator 签名证明 "这个 agent 归我管"
 */
export async function delegateAgentKey(
  operatorKey: OperatorKeyPair,
  agentId: string,
  ttlDays: number,
): Promise<AgentKeyPair> {
  // 生成 agent 的 Ed25519 密钥对
  const agentPrivateBytes = ed.utils.randomPrivateKey()
  const agentPublicBytes = ed.getPublicKey(agentPrivateBytes)
  const agentPublicKey = bytesToHex(agentPublicBytes)

  // 计算到期时间
  const expiresAt = Math.floor(Date.now() / 1000) + ttlDays * 86400

  // Operator 签名委托信息："agent_pubkey:agent_id:expires_at"
  const delegationMessage = `${agentPublicKey}:${agentId}:${expiresAt}`
  const messageBytes = new TextEncoder().encode(delegationMessage)
  const sigBytes = ed.sign(messageBytes, hexToBytes(operatorKey.privateKey))

  return {
    publicKey: agentPublicKey,
    privateKey: bytesToHex(agentPrivateBytes),
    delegatedBy: operatorKey.publicKey,
    agentId,
    expiresAt,
    delegationSig: bytesToHex(sigBytes),
  }
}

/**
 * 吊销 Agent 子密钥
 *
 * 生成一个签名的 identity.revoke 事件
 * 吊销后该子密钥不能再发新事件
 */
export async function revokeAgentKey(
  operatorKey: OperatorKeyPair,
  agentPubkey: string,
  reason?: string,
): Promise<SerendipEvent<'identity.revoke'>> {
  const content: RevokeContent = {
    agent_pubkey: agentPubkey,
    reason,
  }

  // 使用统一的 createEvent + signEvent，确保 canonicalize 一致
  const unsigned = createEvent('identity.revoke', content, [], operatorKey.publicKey)
  return signEvent(unsigned, operatorKey.privateKey)
}
