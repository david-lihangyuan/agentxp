/**
 * B6 - 身份注册与子密钥验证测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb } from '../src/db.js'
import {
  registerOperator,
  delegateAgent,
  revokeAgent,
  verifyIdentity,
  getIdentity,
  listAgentsByOperator,
  listOperators,
} from '../src/identity-store.js'
import {
  generateOperatorKey,
  delegateAgentKey,
  revokeAgentKey,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import type Database from 'better-sqlite3'

// 辅助：生成签名的 identity.register 事件
async function makeRegisterEvent(key?: Awaited<ReturnType<typeof generateOperatorKey>>) {
  const k = key ?? await generateOperatorKey()
  const unsigned = createEvent('identity.register', { name: 'Test Operator' }, [], k.publicKey)
  const signed = await signEvent(unsigned, k.privateKey)
  return { signed, key: k }
}

// 辅助：生成签名的 identity.delegate 事件
async function makeDelegateEvent(
  operatorKey: Awaited<ReturnType<typeof generateOperatorKey>>,
  agentPubkey: string,
  expiresAt: number,
) {
  const content = {
    agent_pubkey: agentPubkey,
    agent_id: 'test-agent',
    ttl_days: 30,
    expires_at: expiresAt,
  }
  const unsigned = createEvent('identity.delegate', content, [], operatorKey.publicKey)
  return signEvent(unsigned, operatorKey.privateKey)
}

describe('B6 - 身份注册与子密钥验证', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createInMemoryDb()
  })

  describe('registerOperator', () => {
    it('注册合法 operator 成功', async () => {
      const { signed, key } = await makeRegisterEvent()
      const result = registerOperator(db, signed)
      expect(result.ok).toBe(true)
      expect(result.pubkey).toBe(key.publicKey)
    })

    it('注册后可以查到 identity', async () => {
      const { signed, key } = await makeRegisterEvent()
      registerOperator(db, signed)
      const identity = getIdentity(db, key.publicKey)
      expect(identity).not.toBeNull()
      expect(identity?.kind).toBe('operator')
      expect(identity?.revoked).toBe(false)
      expect(identity?.delegated_by).toBeNull()
      expect(identity?.expires_at).toBeNull()
    })

    it('重复注册幂等（不报错）', async () => {
      const { signed } = await makeRegisterEvent()
      const r1 = registerOperator(db, signed)
      const r2 = registerOperator(db, signed)
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
    })

    it('拒绝非 identity.register 的事件', async () => {
      const key = await generateOperatorKey()
      const unsigned = createEvent('intent.broadcast', { title: 'x', summary: 'y' }, [], key.publicKey)
      const signed = await signEvent(unsigned, key.privateKey)
      const result = registerOperator(db, signed)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('identity.register')
    })
  })

  describe('delegateAgent', () => {
    it('注册后的 operator 可以委托 agent', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey() // 用于生成 agent pubkey
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)

      const result = delegateAgent(db, delegateEvent)
      expect(result.ok).toBe(true)
      expect(result.pubkey).toBe(agentKey.publicKey)
    })

    it('委托后 agent 可以查到', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent)

      const identity = getIdentity(db, agentKey.publicKey)
      expect(identity?.kind).toBe('agent')
      expect(identity?.delegated_by).toBe(opKey.publicKey)
      expect(identity?.revoked).toBe(false)
    })

    it('未注册的 operator 不能委托', async () => {
      const opKey = await generateOperatorKey()
      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)

      const result = delegateAgent(db, delegateEvent)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not valid')
    })

    it('拒绝缺少 agent_pubkey 的委托', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const unsigned = createEvent('identity.delegate', {
        agent_id: 'test-agent',
        ttl_days: 30,
        expires_at: Math.floor(Date.now() / 1000) + 86400,
      }, [], opKey.publicKey)
      const signed = await signEvent(unsigned, opKey.privateKey)

      const result = delegateAgent(db, signed)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('agent_pubkey')
    })

    it('agent 不能委托 agent（agent 不是 operator）', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      // 委托第一个 agent
      const agentKey1 = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent1 = await makeDelegateEvent(opKey, agentKey1.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent1)

      // 第一个 agent 尝试委托第二个 agent
      const agentKey2 = await generateOperatorKey()
      const delegateEvent2 = await makeDelegateEvent(
        // 用 agentKey1 作为"operator"去签事件 —— 但它不是 operator
        agentKey1 as any,
        agentKey2.publicKey,
        futureExpiry,
      )
      const result = delegateAgent(db, delegateEvent2)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not an operator')
    })

    it('重复委托同一 agent 幂等', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
      const r1 = delegateAgent(db, delegateEvent)
      const r2 = delegateAgent(db, delegateEvent)
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
    })
  })

  describe('revokeAgent', () => {
    it('operator 可以吊销自己委托的 agent', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent)

      const revokeEvent = await revokeAgentKey(opKey, agentKey.publicKey, 'test revoke')
      const result = revokeAgent(db, revokeEvent)
      expect(result.ok).toBe(true)
    })

    it('吊销后 agent.revoked = true', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent)

      const revokeEvent = await revokeAgentKey(opKey, agentKey.publicKey)
      revokeAgent(db, revokeEvent)

      const identity = getIdentity(db, agentKey.publicKey)
      expect(identity?.revoked).toBe(true)
    })

    it('其他 operator 不能吊销不属于自己的 agent', async () => {
      const { signed: regEvent1, key: opKey1 } = await makeRegisterEvent()
      registerOperator(db, regEvent1)
      const { signed: regEvent2, key: opKey2 } = await makeRegisterEvent()
      registerOperator(db, regEvent2)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey1, agentKey.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent)

      // opKey2 尝试吊销 opKey1 委托的 agent
      const revokeEvent = await revokeAgentKey(opKey2, agentKey.publicKey, 'unauthorized')
      const result = revokeAgent(db, revokeEvent)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Not authorized')
    })

    it('吊销不存在的 agent 返回错误', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const revokeEvent = await revokeAgentKey(opKey, 'a'.repeat(64))
      const result = revokeAgent(db, revokeEvent)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('不能吊销 operator（只能吊销 agent）', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      // 构造一个吊销自己的事件
      const revokeEvent = await revokeAgentKey(opKey, opKey.publicKey)
      const result = revokeAgent(db, revokeEvent)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Cannot revoke an operator')
    })

    it('重复吊销幂等', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent)

      const revokeEvent1 = await revokeAgentKey(opKey, agentKey.publicKey)
      const revokeEvent2 = await revokeAgentKey(opKey, agentKey.publicKey)
      const r1 = revokeAgent(db, revokeEvent1)
      const r2 = revokeAgent(db, revokeEvent2)
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
    })
  })

  describe('verifyIdentity', () => {
    it('已注册的 operator 有效', async () => {
      const { signed, key } = await makeRegisterEvent()
      registerOperator(db, signed)
      const result = verifyIdentity(db, key.publicKey)
      expect(result.valid).toBe(true)
      expect(result.identity?.kind).toBe('operator')
    })

    it('未注册的 pubkey 无效', () => {
      const result = verifyIdentity(db, 'a'.repeat(64))
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('not_found')
    })

    it('被吊销的 agent 无效', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent)

      const revokeEvent = await revokeAgentKey(opKey, agentKey.publicKey)
      revokeAgent(db, revokeEvent)

      const result = verifyIdentity(db, agentKey.publicKey)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('revoked')
    })

    it('过期的 agent 无效', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      // 过期时间设在过去
      const pastExpiry = Math.floor(Date.now() / 1000) - 1000
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, pastExpiry)
      delegateAgent(db, delegateEvent)

      const result = verifyIdentity(db, agentKey.publicKey)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('expired')
    })

    it('未过期的 agent 有效', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent)

      const result = verifyIdentity(db, agentKey.publicKey)
      expect(result.valid).toBe(true)
    })

    it('operator 被吊销时其下 agent 也无效', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent)

      // 手动把 operator 标记为吊销（模拟）
      db.prepare('UPDATE identities SET revoked = 1 WHERE pubkey = ?').run(opKey.publicKey)

      const result = verifyIdentity(db, agentKey.publicKey)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('operator_revoked')
    })

    it('可以通过 now 参数模拟时间', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const expiresAt = 1000000
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, expiresAt)
      delegateAgent(db, delegateEvent)

      // 过期前有效
      const before = verifyIdentity(db, agentKey.publicKey, 999999)
      expect(before.valid).toBe(true)

      // 过期后无效
      const after = verifyIdentity(db, agentKey.publicKey, 1000001)
      expect(after.valid).toBe(false)
      expect(after.reason).toBe('expired')
    })
  })

  describe('listAgentsByOperator', () => {
    it('返回该 operator 下的所有 agent', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      for (let i = 0; i < 3; i++) {
        const agentKey = await generateOperatorKey()
        const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
        const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
        delegateAgent(db, delegateEvent)
      }

      const agents = listAgentsByOperator(db, opKey.publicKey)
      expect(agents).toHaveLength(3)
      expect(agents.every(a => a.kind === 'agent')).toBe(true)
      expect(agents.every(a => a.delegated_by === opKey.publicKey)).toBe(true)
    })

    it('默认不包含被吊销的 agent', async () => {
      const { signed: regEvent, key: opKey } = await makeRegisterEvent()
      registerOperator(db, regEvent)

      const agentKey = await generateOperatorKey()
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 30
      const delegateEvent = await makeDelegateEvent(opKey, agentKey.publicKey, futureExpiry)
      delegateAgent(db, delegateEvent)

      const revokeEvent = await revokeAgentKey(opKey, agentKey.publicKey)
      revokeAgent(db, revokeEvent)

      const withoutRevoked = listAgentsByOperator(db, opKey.publicKey, false)
      const withRevoked = listAgentsByOperator(db, opKey.publicKey, true)
      expect(withoutRevoked).toHaveLength(0)
      expect(withRevoked).toHaveLength(1)
    })
  })

  describe('listOperators', () => {
    it('返回所有注册的 operator', async () => {
      for (let i = 0; i < 3; i++) {
        const { signed } = await makeRegisterEvent()
        registerOperator(db, signed)
      }
      const operators = listOperators(db)
      expect(operators).toHaveLength(3)
      expect(operators.every(o => o.kind === 'operator')).toBe(true)
    })

    it('默认不包含被吊销的 operator', async () => {
      const { signed, key } = await makeRegisterEvent()
      registerOperator(db, signed)
      db.prepare('UPDATE identities SET revoked = 1 WHERE pubkey = ?').run(key.publicKey)

      const without = listOperators(db, false)
      const withRevoked = listOperators(db, true)
      expect(without).toHaveLength(0)
      expect(withRevoked).toHaveLength(1)
    })
  })
})
