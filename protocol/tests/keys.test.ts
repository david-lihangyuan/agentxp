import { describe, it, expect } from 'vitest'
import { generateOperatorKey, delegateAgentKey, revokeAgentKey } from '../src/keys.js'

describe('A2: Ed25519 密钥对生成', () => {
  it('生成 Operator 主密钥', async () => {
    const operatorKey = await generateOperatorKey()

    expect(operatorKey.publicKey).toHaveLength(64) // hex
    expect(operatorKey.privateKey).toHaveLength(64) // 32 bytes = 64 hex chars
    expect(operatorKey.publicKey).toMatch(/^[0-9a-f]+$/)
    expect(operatorKey.privateKey).toMatch(/^[0-9a-f]+$/)
  })

  it('每次生成不同的密钥', async () => {
    const key1 = await generateOperatorKey()
    const key2 = await generateOperatorKey()

    expect(key1.publicKey).not.toBe(key2.publicKey)
    expect(key1.privateKey).not.toBe(key2.privateKey)
  })

  it('签发 Agent 子密钥', async () => {
    const operatorKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(operatorKey, 'agent-001', 90)

    expect(agentKey.publicKey).toHaveLength(64)
    expect(agentKey.privateKey).toHaveLength(64)
    expect(agentKey.delegatedBy).toBe(operatorKey.publicKey)
    expect(agentKey.agentId).toBe('agent-001')
    expect(agentKey.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(agentKey.delegationSig).toMatch(/^[0-9a-f]+$/)
    expect(agentKey.delegationSig).toHaveLength(128) // 64 bytes
  })

  it('Agent 子密钥的委托签名可以用 Operator 公钥验证', async () => {
    const operatorKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(operatorKey, 'agent-002', 30)

    // 委托签名是对 "agent_pubkey:agent_id:expires_at" 的签名
    // 这里只验证签名存在且格式正确，详细验证在 events.test.ts
    expect(agentKey.delegationSig).toBeDefined()
    expect(agentKey.delegatedBy).toBe(operatorKey.publicKey)
  })

  it('吊销 Agent 子密钥生成吊销事件', async () => {
    const operatorKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(operatorKey, 'agent-003', 90)

    const revokeEvent = await revokeAgentKey(operatorKey, agentKey.publicKey, '密钥泄露')

    expect(revokeEvent.kind).toBe('identity.revoke')
    expect(revokeEvent.pubkey).toBe(operatorKey.publicKey)
    expect(revokeEvent.content.agent_pubkey).toBe(agentKey.publicKey)
    expect(revokeEvent.content.reason).toBe('密钥泄露')
    expect(revokeEvent.sig).toBeDefined()
    expect(revokeEvent.id).toBeDefined()
  })

  it('独立开发者模式：operator = agent 自己', async () => {
    // 独立开发者直接用 operator 密钥当 agent 密钥
    const key = await generateOperatorKey()

    // 作为 operator
    expect(key.publicKey).toHaveLength(64)

    // 直接用来签名事件也可以（不需要 delegate）
    // 这个场景会在 events.test.ts 里详细测试
  })

  it('子密钥有效期计算正确', async () => {
    const operatorKey = await generateOperatorKey()
    const now = Math.floor(Date.now() / 1000)

    const key30 = await delegateAgentKey(operatorKey, 'short', 30)
    const key90 = await delegateAgentKey(operatorKey, 'long', 90)

    // 30天 ≈ 2592000 秒
    expect(key30.expiresAt).toBeGreaterThanOrEqual(now + 30 * 86400 - 5)
    expect(key30.expiresAt).toBeLessThanOrEqual(now + 30 * 86400 + 5)

    // 90天 ≈ 7776000 秒
    expect(key90.expiresAt).toBeGreaterThanOrEqual(now + 90 * 86400 - 5)
    expect(key90.expiresAt).toBeLessThanOrEqual(now + 90 * 86400 + 5)
  })
})
