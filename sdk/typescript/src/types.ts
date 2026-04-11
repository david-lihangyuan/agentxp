/**
 * SDK 专用类型定义
 *
 * 这是应用层（AgentXP / 其他场景）的类型，不属于协议核心。
 * 协议核心类型从 @serendip/protocol 导入。
 */

import type { ExperienceData } from '@serendip/protocol'

// ── 连接配置 ─────────────────────────────────────────────────────

export interface SerendipClientConfig {
  /** 超级节点 HTTP 基础 URL，如 http://localhost:3141 */
  supernodeUrl: string
  /** 连接超时（毫秒），默认 10000 */
  timeoutMs?: number
  /** 最大重试次数，默认 3 */
  maxRetries?: number
}

// ── 发布参数 ─────────────────────────────────────────────────────

export interface PublishExperienceParams {
  /** 做了什么 / 遇到了什么 */
  what: string
  /** 上下文环境，如 "docker@25.0, macOS@15" */
  context: string
  /** 尝试了什么 */
  tried: string
  /** 结果 */
  outcome: 'succeeded' | 'failed' | 'partial'
  /** 结果详情（可选） */
  outcome_detail?: string
  /** 学到了什么 */
  learned: string
  /** 标签（可选，协助搜索） */
  tags?: string[]
  /** 可见性（可选，默认 public） */
  visibility?: 'public' | 'private'
}

// ── 搜索参数 ─────────────────────────────────────────────────────

export interface SearchParams {
  /** 搜索查询（自然语言） */
  query: string
  /** 结果数量上限，默认 10 */
  limit?: number
  /** 标签过滤（可选） */
  tags?: string[]
  /** 是否启用 precision 通道（默认 true） */
  precision?: boolean
  /** 是否启用 serendipity 通道（默认 true） */
  serendipity?: boolean
}

// ── 搜索结果 ─────────────────────────────────────────────────────

export interface ScoreBreakdown {
  embedding_score: number
  trust_score: number
  quality_score: number
  age_decay: number
}

export interface SearchResultItem {
  /** 事件 ID */
  event_id: string
  /** 综合匹配分数 */
  match_score: number
  /** 分数来源（可追溯） */
  score_breakdown: ScoreBreakdown
  /** 经验内容 */
  experience: ExperienceData
  /** 发布者公钥 */
  pubkey: string
  /** 标签 */
  tags: string[]
  /** 发布时间（Unix 秒） */
  created_at: number
}

export interface SearchResults {
  /** 高相关度结果 */
  precision: SearchResultItem[]
  /** 意外发现结果 */
  serendipity: SearchResultItem[]
  /** 搜索耗时（毫秒） */
  took_ms: number
}

// ── Pulse Events ──────────────────────────────────────────────────

export type PulseEventType = 'discovered' | 'verified' | 'propagating'

export interface PulseEvent {
  /** 事件 ID */
  id: string
  /** 相关经验 ID */
  intent_id: string
  /** 变化类型 */
  type: PulseEventType
  /** 人类可读描述 */
  context: string
  /** 事件时间（Unix 秒） */
  occurred_at: number
}

// ── 发布响应 ─────────────────────────────────────────────────────

export interface PublishResult {
  /** 发布成功 */
  success: boolean
  /** 事件 ID */
  event_id?: string
  /** 错误信息 */
  error?: string
}

// ── 网络健康度 ────────────────────────────────────────────────────

export interface NetworkHealth {
  /** 节点状态 */
  status: 'ok' | 'degraded' | 'down'
  /** 已知超级节点数量 */
  active_nodes: number
  /** 全网经验总数 */
  total_experiences: number
  /** 最近一次同步时间 */
  last_sync_at?: number
}
