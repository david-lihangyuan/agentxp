/**
 * SDK1 — TypeScript SDK 测试
 *
 * 测试策略：
 * - 密钥生成和加载（纯本地，不需要网络）
 * - 事件签名（纯本地）
 * - HTTP 调用 mock（不依赖真实超级节点）
 *
 * 不测试：真实网络连接（留给 e2e 测试）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SerendipClient } from '../src/client.js'
import type { OperatorKeyPair, AgentKeyPair } from '@serendip/protocol'
import { generateOperatorKey, delegateAgentKey, verifyEvent } from '@serendip/protocol'

// ── Mock fetch ────────────────────────────────────────────────────

function mockFetch(response: { status: number; body: unknown }): () => void {
  const mock = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    text: async () => JSON.stringify(response.body),
    json: async () => response.body,
  })
  vi.stubGlobal('fetch', mock)
  return () => vi.unstubAllGlobals()
}

// ── 测试准备 ────────────────────────────────────────────────────

let operatorKey: OperatorKeyPair
let agentKey: AgentKeyPair

beforeEach(async () => {
  operatorKey = await generateOperatorKey()
  agentKey = await delegateAgentKey(operatorKey, 'test-agent', 90)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── 密钥管理 ─────────────────────────────────────────────────────

describe('密钥管理', () => {
  it('generateKeys() 应返回有效的 operator 和 agent 密钥对', async () => {
    const cleanup = mockFetch({ status: 200, body: {} })
    try {
      const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
      const { operator, agent } = await client.generateKeys()

      expect(operator.publicKey).toHaveLength(64)
      expect(operator.privateKey).toBeDefined()
      expect(agent.publicKey).toHaveLength(64)
      expect(agent.delegatedBy).toBe(operator.publicKey)
      expect(agent.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    } finally {
      cleanup()
    }
  })

  it('generateKeys() 后 pubkey 应返回 agent 公钥', async () => {
    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    expect(client.pubkey).toBeUndefined()
    await client.generateKeys()
    expect(client.pubkey).toHaveLength(64)
  })

  it('loadKeys() 应正确加载密钥', () => {
    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    client.loadKeys(operatorKey, agentKey)
    expect(client.pubkey).toBe(agentKey.publicKey)
  })
})

// ── 发布经验 ─────────────────────────────────────────────────────

describe('发布经验', () => {
  it('publishExperience() 应构建签名事件并 POST 到超级节点', async () => {
    let capturedBody: unknown
    const mock = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedBody = JSON.parse(options?.body as string)
      return {
        ok: true,
        status: 200,
        text: async () => '{"event_id":"test-id"}',
        json: async () => ({ event_id: 'test-id' }),
      }
    })
    vi.stubGlobal('fetch', mock)

    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    client.loadKeys(operatorKey, agentKey)

    const result = await client.publishExperience({
      what: 'Docker DNS 解析失败',
      context: 'docker@25.0',
      tried: 'docker run --dns 8.8.8.8 nginx',
      outcome: 'succeeded',
      learned: '指定 DNS 服务器可以绕过 Docker 默认 DNS bug',
      tags: ['docker', 'dns'],
    })

    expect(result.success).toBe(true)
    expect(result.event_id).toBe('test-id')

    // 验证发送的事件格式
    const body = capturedBody as Record<string, unknown>
    expect(body.kind).toBe('intent.broadcast')
    expect(body.pubkey).toBe(agentKey.publicKey)
    expect(body.sig).toBeDefined()
    expect(body.id).toBeDefined()
    const content = body.content as Record<string, unknown>
    expect(content.type).toBe('experience')

    vi.unstubAllGlobals()
  })

  it('publishExperience() 应生成可验证的签名', async () => {
    let capturedEvent: unknown
    const mock = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedEvent = JSON.parse(options?.body as string)
      return {
        ok: true,
        status: 200,
        text: async () => '{}',
        json: async () => ({}),
      }
    })
    vi.stubGlobal('fetch', mock)

    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    client.loadKeys(operatorKey, agentKey)

    await client.publishExperience({
      what: '测试发布',
      context: 'test',
      tried: 'unit test',
      outcome: 'succeeded',
      learned: '签名应当可验证',
    })

    // 验证签名合法
    const isValid = await verifyEvent(capturedEvent as Parameters<typeof verifyEvent>[0])
    expect(isValid).toBe(true)

    vi.unstubAllGlobals()
  })

  it('没有密钥时 publishExperience() 应返回错误', async () => {
    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    const result = await client.publishExperience({
      what: '测试',
      context: 'test',
      tried: 'test',
      outcome: 'failed',
      learned: '没有密钥',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('No agent key')
  })

  it('超级节点返回错误时应返回失败', async () => {
    const cleanup = mockFetch({ status: 400, body: { error: 'invalid signature' } })
    try {
      const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
      client.loadKeys(operatorKey, agentKey)

      const result = await client.publishExperience({
        what: '测试',
        context: 'test',
        tried: 'test',
        outcome: 'failed',
        learned: '服务器拒绝了',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('400')
    } finally {
      cleanup()
    }
  })
})

// ── 搜索 ─────────────────────────────────────────────────────────

describe('搜索', () => {
  it('search() 应构建正确的查询参数并返回结果', async () => {
    let capturedUrl: string = ''
    const mockResults = {
      precision: [
        {
          event_id: 'evt-1',
          match_score: 0.92,
          score_breakdown: { embedding_score: 0.9, trust_score: 1.0, quality_score: 0.8, age_decay: 0.95 },
          experience: {
            what: 'Docker DNS 问题',
            context: 'docker@25',
            tried: '--dns 8.8.8.8',
            outcome: 'succeeded',
            learned: '指定 DNS',
          },
          pubkey: 'a'.repeat(64),
          tags: ['docker'],
          created_at: 1700000000,
        },
      ],
      serendipity: [],
      took_ms: 42,
    }

    const mock = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResults),
        json: async () => mockResults,
      }
    })
    vi.stubGlobal('fetch', mock)

    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    client.loadKeys(operatorKey, agentKey)

    const results = await client.search({ query: 'Docker 问题', tags: ['docker'] })

    expect(capturedUrl).toContain('q=Docker+%E9%97%AE%E9%A2%98')
    expect(capturedUrl).toContain('tags=docker')
    expect(capturedUrl).toContain(`agent_pubkey=${agentKey.publicKey}`)
    expect(results.precision).toHaveLength(1)
    expect(results.precision[0].match_score).toBe(0.92)
    expect(results.serendipity).toHaveLength(0)
    expect(results.took_ms).toBe(42)

    vi.unstubAllGlobals()
  })

  it('search() 不带密钥时不应附加 agent_pubkey 参数', async () => {
    let capturedUrl: string = ''
    const mock = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url
      return {
        ok: true,
        status: 200,
        text: async () => '{"precision":[],"serendipity":[],"took_ms":1}',
        json: async () => ({ precision: [], serendipity: [], took_ms: 1 }),
      }
    })
    vi.stubGlobal('fetch', mock)

    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    await client.search({ query: '测试' })

    expect(capturedUrl).not.toContain('agent_pubkey')
    vi.unstubAllGlobals()
  })

  it('超级节点搜索失败时应抛出错误', async () => {
    const cleanup = mockFetch({ status: 500, body: 'internal error' })
    try {
      const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
      await expect(client.search({ query: '测试' })).rejects.toThrow('500')
    } finally {
      cleanup()
    }
  })
})

// ── Pulse Events ──────────────────────────────────────────────────

describe('Pulse Events', () => {
  it('pullPulseEvents() 应附带 agent_pubkey 和 since 参数', async () => {
    let capturedUrl: string = ''
    const mockEvents = {
      events: [
        {
          id: 'pulse-1',
          intent_id: 'evt-1',
          type: 'discovered',
          context: '你的经验被一个 agent 搜到了',
          occurred_at: 1700001000,
        },
      ],
    }

    const mock = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockEvents),
        json: async () => mockEvents,
      }
    })
    vi.stubGlobal('fetch', mock)

    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    client.loadKeys(operatorKey, agentKey)

    const since = Date.now() - 3600 * 1000
    const events = await client.pullPulseEvents(since)

    expect(capturedUrl).toContain(`agent_pubkey=${agentKey.publicKey}`)
    expect(capturedUrl).toContain(`since=${since}`)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('discovered')

    vi.unstubAllGlobals()
  })

  it('没有密钥时 pullPulseEvents() 应抛出错误', async () => {
    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    await expect(client.pullPulseEvents()).rejects.toThrow('No agent key')
  })
})

// ── 验证经验 ─────────────────────────────────────────────────────

describe('验证经验', () => {
  it('verifyExperience() 应发送 intent.verify 事件', async () => {
    let capturedBody: unknown
    const mock = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedBody = JSON.parse(options?.body as string)
      return {
        ok: true,
        status: 200,
        text: async () => '{}',
        json: async () => ({}),
      }
    })
    vi.stubGlobal('fetch', mock)

    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    client.loadKeys(operatorKey, agentKey)

    const result = await client.verifyExperience({
      target_event_id: 'target-event-123',
      result: 'confirmed',
      environment: 'docker@25.0',
      detail: '在相同环境下复现并验证有效',
    })

    expect(result.success).toBe(true)
    const body = capturedBody as Record<string, unknown>
    expect(body.kind).toBe('intent.verify')
    const content = body.content as Record<string, unknown>
    expect(content.target_event_id).toBe('target-event-123')
    expect(content.result).toBe('confirmed')

    vi.unstubAllGlobals()
  })
})

// ── 本地签名验证 ──────────────────────────────────────────────────

describe('本地签名验证', () => {
  it('verifyEventSignature() 对合法签名应返回 true', async () => {
    let capturedEvent: unknown
    const mock = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
      capturedEvent = JSON.parse(options?.body as string)
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) }
    })
    vi.stubGlobal('fetch', mock)

    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
    client.loadKeys(operatorKey, agentKey)

    await client.publishExperience({
      what: '测试', context: 'test', tried: 'test',
      outcome: 'succeeded', learned: '签名验证',
    })

    const isValid = await client.verifyEventSignature(
      capturedEvent as Parameters<typeof client.verifyEventSignature>[0]
    )
    expect(isValid).toBe(true)

    vi.unstubAllGlobals()
  })

  it('verifyEventSignature() 对被篡改的事件应返回 false', async () => {
    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })

    const fakeEvent = {
      id: 'a'.repeat(64),
      pubkey: agentKey.publicKey,
      created_at: 1700000000,
      kind: 'intent.broadcast' as const,
      content: { type: 'experience', data: { what: '篡改了', context: '', tried: '', outcome: 'failed', learned: '' } },
      tags: [],
      sig: 'b'.repeat(128), // 无效签名
    }

    const isValid = await client.verifyEventSignature(fakeEvent)
    expect(isValid).toBe(false)
  })
})

// ── 配置选项 ─────────────────────────────────────────────────────

describe('配置选项', () => {
  it('应去掉 supernodeUrl 末尾的斜杠', async () => {
    let capturedUrl: string = ''
    const mock = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url
      return { ok: true, status: 200, text: async () => '{"precision":[],"serendipity":[],"took_ms":0}', json: async () => ({ precision: [], serendipity: [], took_ms: 0 }) }
    })
    vi.stubGlobal('fetch', mock)

    const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141/' })
    await client.search({ query: 'test' })

    // URL 路径不应有双斜杠（http:// 本身的 // 排除在外）
    const path = capturedUrl.replace('http://', '')
    expect(path).not.toContain('//')
    expect(capturedUrl).toMatch(/^http:\/\/localhost:3141\//)

    vi.unstubAllGlobals()
  })
})
