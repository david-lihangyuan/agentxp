import { describe, it, expect } from 'vitest'
import { generateOperatorKey, delegateAgentKey } from '../src/keys.js'
import { createEvent, signEvent, verifyEvent, canonicalize } from '../src/events.js'
import type { IntentPayload, ExperiencePayload, ExperienceData, UnsignedEvent } from '../src/types.js'

describe('A3: 事件签名与验证（v3 — 协议层 Kind）', () => {
  // 应用层 payload（AgentXP 经验），通过 intent.broadcast 广播
  const sampleExperiencePayload: ExperiencePayload = {
    type: 'experience',
    data: {
      what: 'Docker DNS 配置问题',
      context: 'Docker 25.0 on Ubuntu 22.04',
      tried: '修改 /etc/resolv.conf 并重启容器',
      outcome: 'succeeded',
      learned: 'Docker 容器 DNS 问题先重启容器清缓存',
    } as ExperienceData,
    summary: '容器 DNS 解析失败，重启容器解决',
    tags: ['docker', 'dns'],
  }

  it('createEvent 构建未签名 intent.broadcast 事件', async () => {
    const operatorKey = await generateOperatorKey()

    const event = createEvent(
      'intent.broadcast',
      sampleExperiencePayload,
      ['docker', 'dns'],
      operatorKey.publicKey,
    )

    // 协议层 Kind
    expect(event.kind).toBe('intent.broadcast')
    expect(event.kind).not.toBe('experience.publish')
    expect(event.pubkey).toBe(operatorKey.publicKey)
    // 应用层 payload 的 type 字段
    expect((event.content as IntentPayload).type).toBe('experience')
    expect(event.tags).toEqual(['docker', 'dns'])
    expect(event.created_at).toBeGreaterThan(0)
    // 未签名事件不应有 id 和 sig
    expect(event).not.toHaveProperty('id')
    expect(event).not.toHaveProperty('sig')
  })

  it('signEvent 签名事件并计算 id', async () => {
    const operatorKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(operatorKey, 'agent-1', 90)

    const unsigned = createEvent(
      'intent.broadcast',
      sampleExperiencePayload,
      ['docker', 'dns'],
      agentKey.publicKey,
      operatorKey.publicKey,
    )

    const signed = await signEvent(unsigned, agentKey.privateKey)

    expect(signed.sig).toBeDefined()
    expect(signed.sig).toMatch(/^[0-9a-f]+$/)
    expect(signed.sig).toHaveLength(128) // 64 bytes = 128 hex
    expect(signed.id).toBeDefined()
    expect(signed.id).toMatch(/^[0-9a-f]+$/)
    expect(signed.id).toHaveLength(64) // SHA-256 = 32 bytes = 64 hex
  })

  it('id = SHA-256(canonicalize(event))', async () => {
    const operatorKey = await generateOperatorKey()

    const unsigned = createEvent(
      'intent.broadcast',
      sampleExperiencePayload,
      ['docker'],
      operatorKey.publicKey,
    )

    const signed = await signEvent(unsigned, operatorKey.privateKey)

    // 重新计算 canonical 并 hash，应该等于 id
    const canonical = canonicalize(unsigned)
    const { sha256 } = await import('@noble/hashes/sha256')
    const { bytesToHex } = await import('@noble/hashes/utils')
    const expectedId = bytesToHex(sha256(new TextEncoder().encode(canonical)))

    expect(signed.id).toBe(expectedId)
  })

  it('verifyEvent 验证合法签名（intent.broadcast）', async () => {
    const operatorKey = await generateOperatorKey()

    const unsigned = createEvent(
      'intent.broadcast',
      sampleExperiencePayload,
      ['docker'],
      operatorKey.publicKey,
    )

    const signed = await signEvent(unsigned, operatorKey.privateKey)
    const valid = await verifyEvent(signed)

    expect(valid).toBe(true)
  })

  it('verifyEvent 用 agent 子密钥签名也能验证', async () => {
    const operatorKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(operatorKey, 'agent-1', 90)

    const unsigned = createEvent(
      'intent.broadcast',
      sampleExperiencePayload,
      ['docker'],
      agentKey.publicKey,
      operatorKey.publicKey,
    )

    const signed = await signEvent(unsigned, agentKey.privateKey)
    const valid = await verifyEvent(signed)

    expect(valid).toBe(true)
  })

  it('篡改 payload data 后验证失败', async () => {
    const operatorKey = await generateOperatorKey()

    const unsigned = createEvent(
      'intent.broadcast',
      sampleExperiencePayload,
      ['docker'],
      operatorKey.publicKey,
    )

    const signed = await signEvent(unsigned, operatorKey.privateKey)

    // 篡改应用层内容（data 字段）
    const tampered = {
      ...signed,
      content: {
        ...(signed.content as ExperiencePayload),
        data: { ...(signed.content as ExperiencePayload).data as ExperienceData, learned: '被篡改了' },
      },
    }

    const valid = await verifyEvent(tampered)
    expect(valid).toBe(false)
  })

  it('篡改 tags 后验证失败', async () => {
    const operatorKey = await generateOperatorKey()

    const unsigned = createEvent(
      'intent.broadcast',
      sampleExperiencePayload,
      ['docker'],
      operatorKey.publicKey,
    )

    const signed = await signEvent(unsigned, operatorKey.privateKey)

    // 篡改标签
    const tampered = { ...signed, tags: ['hacked'] }

    const valid = await verifyEvent(tampered)
    expect(valid).toBe(false)
  })

  it('篡改 id 后验证失败', async () => {
    const operatorKey = await generateOperatorKey()

    const unsigned = createEvent(
      'intent.broadcast',
      sampleExperiencePayload,
      ['docker'],
      operatorKey.publicKey,
    )

    const signed = await signEvent(unsigned, operatorKey.privateKey)

    // 篡改 id
    const tampered = { ...signed, id: 'a'.repeat(64) }

    const valid = await verifyEvent(tampered)
    expect(valid).toBe(false)
  })

  it('canonicalize 确定性序列化', () => {
    const event1: UnsignedEvent<'intent.broadcast'> = {
      pubkey: 'abc',
      created_at: 100,
      kind: 'intent.broadcast',
      content: { type: 'experience', data: { what: 'a', learned: 'b' } },
      tags: ['x', 'y'],
    }

    // 同一个事件多次 canonicalize 应该返回相同结果
    const c1 = canonicalize(event1)
    const c2 = canonicalize(event1)
    expect(c1).toBe(c2)
  })

  it('canonicalize 忽略字段顺序', () => {
    const content: IntentPayload = {
      type: 'experience',
      data: { what: 'a', learned: 'b' },
      summary: '测试',
    }

    const event1: UnsignedEvent<'intent.broadcast'> = {
      pubkey: 'abc',
      created_at: 100,
      kind: 'intent.broadcast',
      content,
      tags: ['x'],
    }

    // 交换字段顺序
    const event2: UnsignedEvent<'intent.broadcast'> = {
      kind: 'intent.broadcast',
      tags: ['x'],
      pubkey: 'abc',
      content,
      created_at: 100,
    }

    expect(canonicalize(event1)).toBe(canonicalize(event2))
  })

  it('不同 Protocol Kind 的事件都能签名验证', async () => {
    const operatorKey = await generateOperatorKey()

    // identity.register
    const registerUnsigned = createEvent(
      'identity.register',
      { name: '测试 Operator', description: '测试身份注册' },
      [],
      operatorKey.publicKey,
    )
    const registerSigned = await signEvent(registerUnsigned, operatorKey.privateKey)
    expect(await verifyEvent(registerSigned)).toBe(true)
    expect(registerSigned.kind).toBe('identity.register')

    // intent.verify — 第三方验证
    const verifyUnsigned = createEvent(
      'intent.verify',
      {
        target_event_id: 'evt-001',
        result: 'confirmed' as const,
        environment: 'Docker 25.0',
        detail: '在同等环境下复现并验证',
      },
      [],
      operatorKey.publicKey,
    )
    const verifySigned = await signEvent(verifyUnsigned, operatorKey.privateKey)
    expect(await verifyEvent(verifySigned)).toBe(true)
    expect(verifySigned.kind).toBe('intent.verify')

    // intent.subscribe — 订阅意图流
    const subscribeUnsigned = createEvent(
      'intent.subscribe',
      {
        payload_types: ['experience', 'capability'],
        tags: ['docker'],
        ttl_seconds: 3600,
      },
      [],
      operatorKey.publicKey,
    )
    const subscribeSigned = await signEvent(subscribeUnsigned, operatorKey.privateKey)
    expect(await verifyEvent(subscribeSigned)).toBe(true)
    expect(subscribeSigned.kind).toBe('intent.subscribe')
  })

  it('不同应用场景的 payload 都能通过 intent.broadcast 广播和验证', async () => {
    const operatorKey = await generateOperatorKey()

    // 场景1：AgentXP 经验
    const expPayload: IntentPayload = {
      type: 'experience',
      data: { what: 'Docker 问题', learned: '解决方案' },
    }

    // 场景2：电商供应意图（同一协议层）
    const commercePayload: IntentPayload = {
      type: 'commerce.supply',
      data: { product: '睫毛膏', quantity: 1000 },
      summary: '供应商提供睫毛膏 1000 件',
    }

    // 场景3：社交意图（同一协议层）
    const socialPayload: IntentPayload = {
      type: 'social.meetup',
      data: { location: '东京', interest: '高尔夫' },
    }

    for (const payload of [expPayload, commercePayload, socialPayload]) {
      const unsigned = createEvent('intent.broadcast', payload, [], operatorKey.publicKey)
      const signed = await signEvent(unsigned, operatorKey.privateKey)
      expect(await verifyEvent(signed)).toBe(true)
      // 协议层 Kind 统一，只有 payload.type 区分场景
      expect(signed.kind).toBe('intent.broadcast')
      expect((signed.content as IntentPayload).type).toBe(payload.type)
    }
  })
})
