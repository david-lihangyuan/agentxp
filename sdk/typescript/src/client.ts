/**
 * SerendipClient — Serendip Protocol TypeScript SDK 主入口
 *
 * 职责：
 * - 管理 Operator 和 Agent 密钥
 * - 签名并发布意图事件到超级节点
 * - 搜索网络上的经验
 * - 拉取 pulse events
 *
 * 设计原则：
 * - 只通过 HTTP REST 接口与超级节点通信（降低集成门槛）
 * - 所有签名在本地完成，私钥不离开 SDK
 * - 网络调用失败时提供明确错误信息，不静默吞掉
 */

import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
  verifyEvent,
} from '@serendip/protocol'
import type { AgentKeyPair, OperatorKeyPair, SerendipEvent } from '@serendip/protocol'
import type {
  SerendipClientConfig,
  PublishExperienceParams,
  PublishResult,
  SearchParams,
  SearchResults,
  SearchResultItem,
  PulseEvent,
  NetworkHealth,
} from './types.js'

export class SerendipClient {
  private readonly config: Required<SerendipClientConfig>
  private operatorKey?: OperatorKeyPair
  private agentKey?: AgentKeyPair

  constructor(config: SerendipClientConfig) {
    this.config = {
      supernodeUrl: config.supernodeUrl.replace(/\/$/, ''), // 去掉尾部斜杠
      timeoutMs: config.timeoutMs ?? 10_000,
      maxRetries: config.maxRetries ?? 3,
    }
  }

  // ── 密钥管理 ────────────────────────────────────────────────────

  /**
   * 生成新的 Operator 密钥对（首次使用时调用）
   * 返回的密钥对需要由调用方持久化保存，SDK 不存储私钥。
   */
  async generateKeys(): Promise<{ operator: OperatorKeyPair; agent: AgentKeyPair }> {
    const operator = await generateOperatorKey()
    const agent = await delegateAgentKey(operator, 'default-agent', 90)
    this.operatorKey = operator
    this.agentKey = agent
    return { operator, agent }
  }

  /**
   * 加载已有密钥对
   * @param operatorKey - 持久化存储的 Operator 密钥对
   * @param agentKey - 持久化存储的 Agent 子密钥对
   */
  loadKeys(operatorKey: OperatorKeyPair, agentKey: AgentKeyPair): void {
    this.operatorKey = operatorKey
    this.agentKey = agentKey
  }

  /**
   * 当前 Agent 公钥（hex）
   */
  get pubkey(): string | undefined {
    return this.agentKey?.publicKey
  }

  // ── 发布 ─────────────────────────────────────────────────────────

  /**
   * 发布一条经验到 Serendip 网络
   *
   * 流程：构建事件 → 本地签名 → POST 到超级节点
   * 私钥不离开本地。
   */
  async publishExperience(params: PublishExperienceParams): Promise<PublishResult> {
    if (!this.agentKey) {
      return { success: false, error: 'No agent key loaded. Call generateKeys() or loadKeys() first.' }
    }

    const payload = {
      type: 'experience' as const,
      data: {
        what: params.what,
        context: params.context,
        tried: params.tried,
        outcome: params.outcome,
        outcome_detail: params.outcome_detail,
        learned: params.learned,
      },
      summary: `${params.what}. Learned: ${params.learned}`.slice(0, 200),
      tags: params.tags ?? [],
    }

    const unsigned = createEvent(
      'intent.broadcast',
      payload,
      params.tags ?? [],
      this.agentKey.publicKey,
      this.agentKey.delegatedBy,
    )

    let signed: SerendipEvent
    try {
      signed = await signEvent(unsigned, this.agentKey.privateKey)
    } catch (err) {
      return {
        success: false,
        error: `Failed to sign event: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    try {
      const res = await this.fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      })

      if (!res.ok) {
        const text = await res.text()
        return { success: false, error: `Supernode rejected event: ${res.status} ${text}` }
      }

      const data = await res.json() as { event_id?: string }
      return { success: true, event_id: data.event_id ?? signed.id }
    } catch (err) {
      return {
        success: false,
        error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // ── 搜索 ─────────────────────────────────────────────────────────

  /**
   * 搜索经验（precision + serendipity 双通道）
   *
   * 搜索前不需要密钥，但如果已加载密钥会附带 pubkey 便于超级节点
   * 过滤掉自己 operator 的命中（防止积分作弊）。
   */
  async search(params: SearchParams): Promise<SearchResults> {
    const query = new URLSearchParams({
      q: params.query,
      limit: String(params.limit ?? 10),
      precision: String(params.precision !== false),
      serendipity: String(params.serendipity !== false),
    })

    if (params.tags && params.tags.length > 0) {
      query.set('tags', params.tags.join(','))
    }

    if (this.agentKey) {
      query.set('agent_pubkey', this.agentKey.publicKey)
    }

    const res = await this.fetch(`/api/search?${query.toString()}`)
    if (!res.ok) {
      throw new Error(`Search failed: ${res.status} ${await res.text()}`)
    }

    const data = await res.json() as {
      precision: SearchResultItem[]
      serendipity: SearchResultItem[]
      took_ms: number
    }

    return {
      precision: data.precision ?? [],
      serendipity: data.serendipity ?? [],
      took_ms: data.took_ms ?? 0,
    }
  }

  // ── Pulse Events ──────────────────────────────────────────────────

  /**
   * 拉取自己经验的变化通知（agent 心跳时调用）
   * @param since - 拉取 since 之后的事件（Unix 毫秒），默认 2 小时前
   */
  async pullPulseEvents(since?: number): Promise<PulseEvent[]> {
    if (!this.agentKey) {
      throw new Error('No agent key loaded.')
    }

    const sinceMs = since ?? Date.now() - 2 * 60 * 60 * 1000
    const query = new URLSearchParams({
      since: String(sinceMs),
      agent_pubkey: this.agentKey.publicKey,
    })

    const res = await this.fetch(`/api/pulse?${query.toString()}`)
    if (!res.ok) {
      throw new Error(`Failed to pull pulse events: ${res.status} ${await res.text()}`)
    }

    const data = await res.json() as { events: PulseEvent[] }
    return data.events ?? []
  }

  // ── 网络健康度 ────────────────────────────────────────────────────

  /**
   * 获取网络健康度指标
   */
  async getNetworkHealth(): Promise<NetworkHealth> {
    const res = await this.fetch('/api/network/health')
    if (!res.ok) {
      throw new Error(`Failed to get network health: ${res.status}`)
    }
    return res.json() as Promise<NetworkHealth>
  }

  // ── 验证 ─────────────────────────────────────────────────────────

  /**
   * 验证一条经验（确认 / 否定 / 部分确认）
   */
  async verifyExperience(params: {
    target_event_id: string
    result: 'confirmed' | 'denied' | 'partial'
    environment?: string
    detail?: string
  }): Promise<PublishResult> {
    if (!this.agentKey) {
      return { success: false, error: 'No agent key loaded.' }
    }

    const unsigned = createEvent(
      'intent.verify',
      {
        target_event_id: params.target_event_id,
        result: params.result,
        environment: params.environment,
        detail: params.detail,
      },
      [],
      this.agentKey.publicKey,
      this.agentKey.delegatedBy,
    )

    let signed: SerendipEvent
    try {
      signed = await signEvent(unsigned, this.agentKey.privateKey)
    } catch (err) {
      return {
        success: false,
        error: `Failed to sign verify event: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    try {
      const res = await this.fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      })

      if (!res.ok) {
        return { success: false, error: `Supernode rejected: ${res.status} ${await res.text()}` }
      }

      return { success: true, event_id: signed.id }
    } catch (err) {
      return {
        success: false,
        error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // ── 本地签名验证（工具方法）────────────────────────────────────

  /**
   * 验证一个事件的签名是否合法（本地，不需要网络）
   */
  async verifyEventSignature(event: SerendipEvent): Promise<boolean> {
    try {
      return await verifyEvent(event)
    } catch {
      return false
    }
  }

  // ── 内部 HTTP 工具 ────────────────────────────────────────────────

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    const url = `${this.config.supernodeUrl}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)

    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const res = await globalThis.fetch(url, {
          ...options,
          signal: controller.signal,
        })
        clearTimeout(timer)
        return res
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        // 超时或 abort 不重试
        if (lastError.name === 'AbortError') {
          break
        }
        // 最后一次失败直接抛
        if (attempt === this.config.maxRetries - 1) {
          break
        }
        // 等待后重试（指数退避）
        await sleep(200 * Math.pow(2, attempt))
      }
    }

    clearTimeout(timer)
    throw lastError ?? new Error('Unknown fetch error')
  }
}

// ── 工具 ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
