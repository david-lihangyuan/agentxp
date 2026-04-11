/**
 * Serendip Protocol — 核心类型定义（v3）
 *
 * 协议层只管 intent，不管场景。
 * 这里的所有类型都是协议通用的，与任何具体应用（AgentXP、电商、交友）无关。
 *
 * 应用层（如 AgentXP）通过扩展 IntentPayload 接入，不影响协议核心。
 */

// ============================================================
// Event Kinds — 协议层通用
// ============================================================

/**
 * 意图类 Kind — 用于在网络上广播、匹配、订阅意图
 * 不绑定任何具体场景（经验/电商/交友等均通过 payload.type 区分）
 */
export type IntentKind =
  | 'intent.broadcast'   // 广播一个意图
  | 'intent.match'       // 响应匹配请求
  | 'intent.verify'      // 第三方验证某条意图记录
  | 'intent.subscribe'   // 订阅某类意图流

/**
 * 身份类 Kind — 用于管理密钥和身份
 */
export type IdentityKind =
  | 'identity.register'  // 注册 Operator 身份
  | 'identity.delegate'  // 签发 Agent 子密钥
  | 'identity.revoke'    // 吊销 Agent 子密钥

export type SerendipKind = IntentKind | IdentityKind

// ============================================================
// Intent Payload — 通用意图内容结构
// ============================================================

/**
 * 通用意图 Payload
 *
 * 协议层只感知 `type`，用于路由和过滤。
 * `data` 的具体结构由应用层（Skill / AgentXP / 电商等）定义。
 *
 * 应用层扩展示例：
 *   interface ExperiencePayload extends IntentPayload {
 *     type: 'experience'
 *     data: { what: string; learned: string; ... }
 *   }
 */
export interface IntentPayload {
  /**
   * Payload 类型标识，由应用层注册和定义。
   * 协议层不理解此字段的具体含义，只用于路由。
   * 例：'experience' | 'capability' | 'commerce' | 'social'
   */
  type: string
  /**
   * 实际内容，结构由 type 决定，协议层视为 unknown。
   */
  data: unknown
  /**
   * 可选：对该意图的简短自然语言描述，用于跨语言语义索引。
   * 协议层可用此字段做 embedding，不依赖 data 的内部结构。
   */
  summary?: string
  /**
   * 可选：标签（语义索引辅助）
   */
  tags?: string[]
}

// ============================================================
// Intent Match Response Content
// ============================================================

export interface ScoreBreakdown {
  embedding_score: number
  trust_score: number
  quality_score: number
  age_decay: number
}

export interface MatchResultItem {
  /** 被匹配到的事件 ID */
  event_id: string
  /** 综合匹配分数 */
  match_score: number
  /** 分数来源（可追溯） */
  score_breakdown: ScoreBreakdown
  /** 被匹配事件的 payload（来自原始事件） */
  payload: IntentPayload
  /** 发布者公钥 */
  pubkey: string
}

export interface IntentMatchContent {
  /** 被匹配的查询（echo） */
  query_payload: IntentPayload
  /** Precision 通道结果（高相关度） */
  precision: MatchResultItem[]
  /** Serendipity 通道结果（意外发现） */
  serendipity: MatchResultItem[]
  /** 搜索耗时（毫秒） */
  took_ms: number
}

// ============================================================
// Intent Subscribe Content
// ============================================================

export interface IntentSubscribeContent {
  /** 订阅的 payload 类型，空数组 = 订阅全部 */
  payload_types: string[]
  /** 标签过滤（可选） */
  tags?: string[]
  /** 订阅 TTL（秒），-1 = 永久 */
  ttl_seconds?: number
}

// ============================================================
// Intent Verify Content
// ============================================================

export type VerificationResult = 'confirmed' | 'denied' | 'partial'

export interface IntentVerifyContent {
  /** 被验证的事件 ID */
  target_event_id: string
  /** 验证结果 */
  result: VerificationResult
  /** 验证者的环境上下文（可选） */
  environment?: string
  /** 验证详情 */
  detail?: string
}

// ============================================================
// Identity Content
// ============================================================

export interface RegisterContent {
  /** Operator 显示名称 */
  name?: string
  /** Operator 描述 */
  description?: string
}

export interface DelegateContent {
  /** Agent 公钥（被签发的子密钥，hex） */
  agent_pubkey: string
  /** Agent 标识符（Operator 内唯一） */
  agent_id: string
  /** 有效期天数 */
  ttl_days: number
  /** 到期时间（Unix 时间戳，秒） */
  expires_at: number
}

export interface RevokeContent {
  /** 被吊销的 Agent 公钥 */
  agent_pubkey: string
  /** 吊销原因 */
  reason?: string
}

// ============================================================
// Content type mapping by Kind
// ============================================================

export interface KindContentMap {
  'intent.broadcast': IntentPayload
  'intent.match': IntentMatchContent
  'intent.verify': IntentVerifyContent
  'intent.subscribe': IntentSubscribeContent
  'identity.register': RegisterContent
  'identity.delegate': DelegateContent
  'identity.revoke': RevokeContent
}

// ============================================================
// SerendipEvent — 核心事件结构
// ============================================================

export interface SerendipEvent<K extends SerendipKind = SerendipKind> {
  /** 事件哈希（内容的 SHA-256，deterministic） */
  id: string
  /** 发布者 Agent 公钥（hex，64 字符） */
  pubkey: string
  /** 创建时间（Unix 时间戳，秒） */
  created_at: number
  /** 事件类型 */
  kind: K
  /** 事件内容，类型由 Kind 决定 */
  content: K extends keyof KindContentMap ? KindContentMap[K] : unknown
  /** 标签（协议层保留，应用层也可扩展） */
  tags: string[]
  /** 上下文版本（如 "docker@25.0"，可选） */
  context_version?: string
  /** Operator 主密钥公钥（hex，可选，用于子密钥体系） */
  operator_pubkey?: string
  /** Ed25519 签名（hex，128 字符） */
  sig: string
}

// ============================================================
// Key Types — 分层密钥体系
// ============================================================

export interface OperatorKeyPair {
  /** 公钥（hex，64 字符） */
  publicKey: string
  /** 私钥（hex） */
  privateKey: string
}

export interface AgentKeyPair {
  /** Agent 公钥（hex，64 字符） */
  publicKey: string
  /** Agent 私钥（hex） */
  privateKey: string
  /** 签发方 Operator 公钥（hex） */
  delegatedBy: string
  /** Agent 标识符 */
  agentId: string
  /** 到期时间（Unix 时间戳，秒） */
  expiresAt: number
  /** Operator 对该委托记录的签名（hex） */
  delegationSig: string
}

// ============================================================
// Merkle Types
// ============================================================

export interface MerkleProof {
  /** 叶子节点的哈希 */
  leaf: string
  /** 证明路径：每个节点含 hash + 方向 */
  path: Array<{
    hash: string
    /** 'left' 表示此 hash 在左边，'right' 表示在右边 */
    position: 'left' | 'right'
  }>
  /** Merkle root */
  root: string
}

// ============================================================
// Unsigned Event (签名前的中间状态)
// ============================================================

export interface UnsignedEvent<K extends SerendipKind = SerendipKind> {
  pubkey: string
  created_at: number
  kind: K
  content: K extends keyof KindContentMap ? KindContentMap[K] : unknown
  tags: string[]
  context_version?: string
  operator_pubkey?: string
}

// ============================================================
// 应用层扩展示例（AgentXP，不属于协议核心）
// ============================================================

/**
 * AgentXP 专用 Payload 类型
 *
 * 这是应用层扩展，不属于 Serendip 协议核心。
 * 发布时：content.type = 'experience'，content.data = ExperienceData
 * 协议核心只看 content.type 做路由，不解析 data 内部结构。
 */
export type ExperienceOutcome = 'succeeded' | 'failed' | 'partial'

export interface ExperienceData {
  /** 做了什么 / 遇到了什么 */
  what: string
  /** 上下文环境 */
  context: string
  /** 尝试了什么 */
  tried: string
  /** 结果 */
  outcome: ExperienceOutcome
  /** 结果详情 */
  outcome_detail?: string
  /** 学到了什么 */
  learned: string
}

/**
 * AgentXP 经验 Payload（应用层，继承 IntentPayload）
 */
export interface ExperiencePayload extends IntentPayload {
  type: 'experience'
  data: ExperienceData
}
