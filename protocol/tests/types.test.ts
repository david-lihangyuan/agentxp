import { describe, it, expect } from 'vitest'
import type {
  SerendipEvent,
  SerendipKind,
  IntentKind,
  IdentityKind,
  IntentPayload,
  IntentMatchContent,
  IntentVerifyContent,
  IntentSubscribeContent,
  RegisterContent,
  DelegateContent,
  RevokeContent,
  OperatorKeyPair,
  AgentKeyPair,
  MerkleProof,
  UnsignedEvent,
  KindContentMap,
  ExperiencePayload,
  ExperienceData,
  MatchResultItem,
} from '../src/types.js'

describe('A1: 协议类型定义（v3 — 协议层只管 intent）', () => {

  // ----------------------------------------------------------
  // 核心：Kind 定义
  // ----------------------------------------------------------

  it('所有 Intent Kind 都以 intent. 开头', () => {
    const intentKinds: IntentKind[] = [
      'intent.broadcast',
      'intent.match',
      'intent.verify',
      'intent.subscribe',
    ]
    for (const kind of intentKinds) {
      expect(kind).toMatch(/^intent\./)
    }
    expect(intentKinds).toHaveLength(4)
  })

  it('所有 Identity Kind 都以 identity. 开头', () => {
    const identityKinds: IdentityKind[] = [
      'identity.register',
      'identity.delegate',
      'identity.revoke',
    ]
    for (const kind of identityKinds) {
      expect(kind).toMatch(/^identity\./)
    }
    expect(identityKinds).toHaveLength(3)
  })

  it('SerendipKind = IntentKind | IdentityKind，全部 7 个', () => {
    const allKinds: SerendipKind[] = [
      'intent.broadcast',
      'intent.match',
      'intent.verify',
      'intent.subscribe',
      'identity.register',
      'identity.delegate',
      'identity.revoke',
    ]
    expect(allKinds).toHaveLength(7)
    for (const kind of allKinds) {
      expect(kind).toMatch(/^(intent|identity)\./)
    }
  })

  it('协议层 Kind 不包含任何 experience.xxx / pulse.xxx / search.xxx', () => {
    // 这是哲学检验：协议层不绑定应用场景
    const allKinds: SerendipKind[] = [
      'intent.broadcast',
      'intent.match',
      'intent.verify',
      'intent.subscribe',
      'identity.register',
      'identity.delegate',
      'identity.revoke',
    ]
    for (const kind of allKinds) {
      expect(kind).not.toMatch(/^experience\./)
      expect(kind).not.toMatch(/^pulse\./)
      expect(kind).not.toMatch(/^search\./)
    }
  })

  // ----------------------------------------------------------
  // IntentPayload — 协议层通用意图结构
  // ----------------------------------------------------------

  it('IntentPayload 是通用结构，type 字段区分场景', () => {
    // AgentXP 经验场景
    const expPayload: IntentPayload = {
      type: 'experience',
      data: { what: 'Docker DNS 问题', learned: '重启容器' },
      summary: '容器 DNS 解析失败后通过重启解决',
      tags: ['docker', 'networking'],
    }
    expect(expPayload.type).toBe('experience')
    expect(expPayload.summary).toBeDefined()

    // 电商场景（协议层同样支持，type 不同）
    const commercePayload: IntentPayload = {
      type: 'commerce.supply',
      data: { product: '睫毛膏', quantity: 1000, price_rmb: 25 },
      summary: '供应商提供睫毛膏 1000 件，单价 25 元',
    }
    expect(commercePayload.type).toBe('commerce.supply')

    // 社交场景
    const socialPayload: IntentPayload = {
      type: 'social.meetup',
      data: { location: '东京', interest: '高尔夫', language: 'zh' },
      summary: '东京打高尔夫的中文用户',
    }
    expect(socialPayload.type).toBe('social.meetup')
  })

  it('IntentPayload data 字段对协议层是 unknown（不解析结构）', () => {
    const payload: IntentPayload = {
      type: 'some-future-type',
      data: { arbitrary: true, nested: { value: 42 } },
    }
    // 协议层只关心 type，不解析 data 内部
    expect(payload.type).toBeDefined()
    expect(payload.data).toBeDefined()
  })

  // ----------------------------------------------------------
  // SerendipEvent — 核心事件结构
  // ----------------------------------------------------------

  it('SerendipEvent<intent.broadcast> 包含所有必需字段', () => {
    const event: SerendipEvent<'intent.broadcast'> = {
      id: 'a'.repeat(64),
      pubkey: '0'.repeat(64),
      created_at: 1775867000,
      kind: 'intent.broadcast',
      content: {
        type: 'experience',
        data: { what: 'Docker DNS 问题', learned: '重启容器' },
        summary: '容器 DNS 解析失败后通过重启解决',
        tags: ['docker'],
      },
      tags: ['docker', 'dns'],
      context_version: 'docker@25.0',
      operator_pubkey: '1'.repeat(64),
      sig: '2'.repeat(128),
    }

    expect(event.id).toHaveLength(64)
    expect(event.pubkey).toHaveLength(64)
    expect(event.kind).toBe('intent.broadcast')
    expect(event.content.type).toBe('experience')
    expect(event.tags).toContain('docker')
    expect(event.sig).toHaveLength(128)
  })

  it('SerendipEvent<intent.broadcast> kind 不是 experience.publish', () => {
    const event: SerendipEvent<'intent.broadcast'> = {
      id: 'a'.repeat(64),
      pubkey: '0'.repeat(64),
      created_at: 1775867000,
      kind: 'intent.broadcast',
      content: { type: 'experience', data: {} },
      tags: [],
      sig: '2'.repeat(128),
    }
    // 哲学检验：kind 是 intent.broadcast，不是 experience.publish
    expect(event.kind).toBe('intent.broadcast')
    expect(event.kind).not.toBe('experience.publish')
  })

  // ----------------------------------------------------------
  // intent.match — 双通道搜索响应
  // ----------------------------------------------------------

  it('IntentMatchContent 包含双通道结果', () => {
    const matchResult: MatchResultItem = {
      event_id: 'evt-001',
      match_score: 0.87,
      score_breakdown: {
        embedding_score: 0.9,
        trust_score: 0.75,
        quality_score: 0.8,
        age_decay: 0.95,
      },
      payload: {
        type: 'experience',
        data: { what: 'Docker DNS', learned: '重启' },
        summary: '容器 DNS 问题',
      },
      pubkey: 'b'.repeat(64),
    }

    const content: IntentMatchContent = {
      query_payload: { type: 'experience', data: { query: 'Docker 网络问题' } },
      precision: [matchResult],
      serendipity: [],
      took_ms: 42,
    }

    expect(content.precision).toHaveLength(1)
    expect(content.precision[0].match_score).toBe(0.87)
    expect(content.serendipity).toHaveLength(0)
    expect(content.took_ms).toBe(42)
  })

  // ----------------------------------------------------------
  // intent.verify — 第三方验证
  // ----------------------------------------------------------

  it('IntentVerifyContent 结构正确', () => {
    const content: IntentVerifyContent = {
      target_event_id: 'evt-abc',
      result: 'confirmed',
      environment: 'Docker 25.0 on Ubuntu 22.04',
      detail: '在相同环境下复现并验证通过',
    }

    expect(content.target_event_id).toBeDefined()
    expect(content.result).toBe('confirmed')
    expect(content.environment).toBeDefined()
  })

  // ----------------------------------------------------------
  // intent.subscribe — 意图流订阅
  // ----------------------------------------------------------

  it('IntentSubscribeContent 支持类型过滤', () => {
    const content: IntentSubscribeContent = {
      payload_types: ['experience', 'capability'],
      tags: ['docker', 'k8s'],
      ttl_seconds: 3600,
    }

    expect(content.payload_types).toContain('experience')
    expect(content.payload_types).toContain('capability')
    expect(content.ttl_seconds).toBe(3600)
  })

  it('IntentSubscribeContent 空 payload_types = 订阅全部', () => {
    const content: IntentSubscribeContent = {
      payload_types: [],
    }
    expect(content.payload_types).toHaveLength(0)
  })

  // ----------------------------------------------------------
  // Identity 类型
  // ----------------------------------------------------------

  it('Identity 相关类型结构正确', () => {
    const register: RegisterContent = {
      name: '李航远 · Serendip Operator',
      description: '思考伙伴的超级节点',
    }
    expect(register.name).toBeDefined()

    const delegate: DelegateContent = {
      agent_pubkey: 'a'.repeat(64),
      agent_id: 'agent-hangyuan-001',
      ttl_days: 90,
      expires_at: Math.floor(Date.now() / 1000) + 90 * 86400,
    }
    expect(delegate.ttl_days).toBe(90)
    expect(delegate.expires_at).toBeGreaterThan(0)

    const revoke: RevokeContent = {
      agent_pubkey: 'a'.repeat(64),
      reason: '密钥可能已泄露',
    }
    expect(revoke.agent_pubkey).toHaveLength(64)
  })

  // ----------------------------------------------------------
  // KindContentMap — 完整映射
  // ----------------------------------------------------------

  it('KindContentMap 覆盖所有协议层 Kind（7 个）', () => {
    type AllKinds = keyof KindContentMap
    const kinds: AllKinds[] = [
      'intent.broadcast',
      'intent.match',
      'intent.verify',
      'intent.subscribe',
      'identity.register',
      'identity.delegate',
      'identity.revoke',
    ]
    expect(kinds).toHaveLength(7)
  })

  // ----------------------------------------------------------
  // Key Types
  // ----------------------------------------------------------

  it('OperatorKeyPair 结构正确', () => {
    const key: OperatorKeyPair = {
      publicKey: 'c'.repeat(64),
      privateKey: 'd'.repeat(64),
    }
    expect(key.publicKey).toHaveLength(64)
    expect(key.privateKey).toHaveLength(64)
  })

  it('AgentKeyPair 包含完整委托信息', () => {
    const key: AgentKeyPair = {
      publicKey: 'e'.repeat(64),
      privateKey: 'f'.repeat(64),
      delegatedBy: 'c'.repeat(64),
      agentId: 'agent-001',
      expiresAt: Math.floor(Date.now() / 1000) + 90 * 86400,
      delegationSig: '0'.repeat(128),
    }

    expect(key.delegatedBy).toHaveLength(64)
    expect(key.agentId).toBe('agent-001')
    expect(key.expiresAt).toBeGreaterThan(Date.now() / 1000)
    expect(key.delegationSig).toHaveLength(128)
  })

  // ----------------------------------------------------------
  // MerkleProof
  // ----------------------------------------------------------

  it('MerkleProof 结构正确', () => {
    const proof: MerkleProof = {
      leaf: 'a'.repeat(64),
      path: [
        { hash: 'b'.repeat(64), position: 'left' },
        { hash: 'c'.repeat(64), position: 'right' },
      ],
      root: 'd'.repeat(64),
    }

    expect(proof.leaf).toHaveLength(64)
    expect(proof.path).toHaveLength(2)
    expect(proof.path[0].position).toBe('left')
    expect(proof.path[1].position).toBe('right')
    expect(proof.root).toHaveLength(64)
  })

  // ----------------------------------------------------------
  // UnsignedEvent — 签名前的中间状态
  // ----------------------------------------------------------

  it('UnsignedEvent 不包含 id 和 sig', () => {
    const unsigned: UnsignedEvent<'intent.broadcast'> = {
      pubkey: '0'.repeat(64),
      created_at: 1775867000,
      kind: 'intent.broadcast',
      content: {
        type: 'experience',
        data: {},
      },
      tags: [],
    }

    expect(unsigned).not.toHaveProperty('id')
    expect(unsigned).not.toHaveProperty('sig')
    expect(unsigned.kind).toBe('intent.broadcast')
  })

  // ----------------------------------------------------------
  // 应用层扩展示例 — ExperiencePayload
  // ----------------------------------------------------------

  it('ExperiencePayload 是 IntentPayload 的应用层扩展', () => {
    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'Docker 容器 DNS 解析失败',
        context: 'Docker 25.0 on macOS',
        tried: '修改 /etc/resolv.conf，重启容器',
        outcome: 'succeeded',
        learned: '重启容器会清 DNS 缓存，无需手动修改 resolv.conf',
      } as ExperienceData,
      summary: '容器 DNS 问题通过重启解决',
      tags: ['docker', 'dns'],
    }

    // 作为 IntentPayload 使用（协议层视角）
    const asProtocolPayload: IntentPayload = payload
    expect(asProtocolPayload.type).toBe('experience')

    // 具体 data（应用层视角）
    const data = payload.data as ExperienceData
    expect(data.what).toContain('DNS')
    expect(data.outcome).toBe('succeeded')
    expect(data.learned).toBeDefined()
  })

  it('ExperiencePayload 可以装进 intent.broadcast 事件', () => {
    const expPayload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: '测试',
        context: '测试环境',
        tried: '测试方法',
        outcome: 'succeeded',
        learned: '测试结论',
      } as ExperienceData,
    }

    const event: SerendipEvent<'intent.broadcast'> = {
      id: 'a'.repeat(64),
      pubkey: '0'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 'intent.broadcast',
      content: expPayload, // ExperiencePayload extends IntentPayload ✅
      tags: [],
      sig: '2'.repeat(128),
    }

    expect(event.kind).toBe('intent.broadcast')
    expect((event.content as ExperiencePayload).type).toBe('experience')
  })
})
