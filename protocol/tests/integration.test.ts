import { describe, it, expect } from 'vitest'
import {
  generateOperatorKey,
  delegateAgentKey,
  revokeAgentKey,
  createEvent,
  signEvent,
  verifyEvent,
  buildMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
} from '../src/index.js'
import type { IntentPayload } from '../src/types.js'

describe('Phase 2A 集成验证（v3 — 协议层 Kind）', () => {
  it('完整链路：密钥生成 → 委托 → 广播意图 → 签名 → 验证 → Merkle 证明', async () => {
    // 1. Operator 注册
    const operator = await generateOperatorKey()

    // 2. 签发 Agent 子密钥
    const agent = await delegateAgentKey(operator, 'my-agent', 90)

    // 3. Agent 广播多条意图（intent.broadcast，payload.type = 'experience'）
    const events = []
    for (let i = 0; i < 5; i++) {
      const payload: IntentPayload = {
        type: 'experience',
        data: {
          what: `问题 ${i}`,
          context: `环境 ${i}`,
          tried: `方法 ${i}`,
          outcome: 'succeeded',
          learned: `教训 ${i}`,
        },
        summary: `经验 ${i} 的摘要`,
        tags: ['test'],
      }
      const unsigned = createEvent(
        'intent.broadcast',    // ← 协议层 Kind（不是 experience.publish）
        payload,
        ['test'],
        agent.publicKey,
        operator.publicKey,
        `tool@${i}.0`,
      )
      const signed = await signEvent(unsigned, agent.privateKey)
      events.push(signed)
    }

    // 4. 验证所有事件的签名
    for (const event of events) {
      expect(await verifyEvent(event)).toBe(true)
      // 哲学检验：kind 是协议层的
      expect(event.kind).toBe('intent.broadcast')
      expect((event.content as IntentPayload).type).toBe('experience')
    }

    // 5. 构建 Merkle tree
    const eventIds = events.map(e => e.id)
    const root = buildMerkleRoot(eventIds)

    // 6. 验证每条事件的包含证明
    for (const event of events) {
      const proof = getMerkleProof(eventIds, event.id)
      expect(verifyMerkleProof(event.id, proof, root)).toBe(true)
    }

    // 7. 篡改检测：修改 payload data 后签名失效
    const tampered = {
      ...events[0],
      content: {
        ...(events[0].content as IntentPayload),
        data: { ...(events[0].content as any).data, learned: '篡改' },
      },
    }
    expect(await verifyEvent(tampered)).toBe(false)

    // 8. Merkle 防伪
    expect(verifyMerkleProof('fake-id', getMerkleProof(eventIds, eventIds[0]), root)).toBe(false)
  })

  it('独立开发者模式：Operator = Agent，零额外复杂度', async () => {
    const key = await generateOperatorKey()

    // 直接用 operator 密钥签名（不需要 delegate）
    const unsigned = createEvent(
      'intent.broadcast',
      {
        type: 'experience',
        data: {
          what: '独立开发者问题',
          context: '本地环境',
          tried: '直接修复',
          outcome: 'succeeded',
          learned: '简单就好',
        },
        summary: '个人开发者的经验分享',
      },
      ['solo'],
      key.publicKey,
    )

    const signed = await signEvent(unsigned, key.privateKey)
    expect(await verifyEvent(signed)).toBe(true)
    expect(signed.kind).toBe('intent.broadcast')
  })

  it('吊销后旧密钥签名的历史事件仍然有效（密码学层面）', async () => {
    const operator = await generateOperatorKey()
    const agent = await delegateAgentKey(operator, 'will-be-revoked', 90)

    // 用 agent 广播一条意图
    const unsigned = createEvent(
      'intent.broadcast',
      {
        type: 'experience',
        data: {
          what: '吊销前的经验',
          context: '测试',
          tried: '测试',
          outcome: 'succeeded',
          learned: '测试',
        },
      },
      [],
      agent.publicKey,
      operator.publicKey,
    )
    const signed = await signEvent(unsigned, agent.privateKey)

    // 吊销 agent
    const revokeEvent = await revokeAgentKey(operator, agent.publicKey, '测试吊销')
    expect(revokeEvent.kind).toBe('identity.revoke')

    // 历史签名仍然有效（密码学层面）
    // 注意：业务层面的吊销检查由超级节点在 Phase 2B 实现
    expect(await verifyEvent(signed)).toBe(true)
    expect(await verifyEvent(revokeEvent)).toBe(true)
  })

  it('不同应用场景都能在同一协议上运行', async () => {
    const operator = await generateOperatorKey()

    // 场景1：AgentXP 经验广播
    const expUnsigned = createEvent(
      'intent.broadcast',
      { type: 'experience', data: { learned: 'Docker 技巧' } },
      ['docker'],
      operator.publicKey,
    )
    const expSigned = await signEvent(expUnsigned, operator.privateKey)

    // 场景2：电商供应意图（同一协议层，不同 payload.type）
    const commerceUnsigned = createEvent(
      'intent.broadcast',
      { type: 'commerce.supply', data: { product: '睫毛膏', qty: 1000 } },
      ['commerce'],
      operator.publicKey,
    )
    const commerceSigned = await signEvent(commerceUnsigned, operator.privateKey)

    // 场景3：社交意图
    const socialUnsigned = createEvent(
      'intent.broadcast',
      { type: 'social.meetup', data: { location: '东京', interest: '高尔夫' } },
      ['social'],
      operator.publicKey,
    )
    const socialSigned = await signEvent(socialUnsigned, operator.privateKey)

    // 所有场景都通过同一协议层验证
    expect(await verifyEvent(expSigned)).toBe(true)
    expect(await verifyEvent(commerceSigned)).toBe(true)
    expect(await verifyEvent(socialSigned)).toBe(true)

    // 协议层 Kind 统一
    expect(expSigned.kind).toBe('intent.broadcast')
    expect(commerceSigned.kind).toBe('intent.broadcast')
    expect(socialSigned.kind).toBe('intent.broadcast')

    // 应用层 payload.type 区分场景
    expect((expSigned.content as IntentPayload).type).toBe('experience')
    expect((commerceSigned.content as IntentPayload).type).toBe('commerce.supply')
    expect((socialSigned.content as IntentPayload).type).toBe('social.meetup')
  })
})
