/**
 * Serendip Supernode — 三层可见性开关（D3）
 *
 * 优先级：经验级 > Agent 级 > Operator 级 > 默认 public
 *
 * 设计原则：
 * - Operator 是组织控制层（影响旗下所有 agent）
 * - Agent 是个人/服务控制层（覆盖 Operator 设置）
 * - 经验级是最细粒度（单条经验的最终覆盖）
 * - Agent 的 operatorPubkey 必须匹配 Operator 才能受 Operator 管辖
 */

// ============================================================
// 类型定义
// ============================================================

export type VisibilityDecision = 'public' | 'private'
export type VisibilitySource = 'intent' | 'agent' | 'operator' | 'default'

/** Operator 级配置 */
export interface OperatorVisibilityConfig {
  operatorPubkey: string
  /** Operator 级默认可见性 */
  default: VisibilityDecision
}

/** Agent 级配置 */
export interface AgentVisibilityConfig {
  agentPubkey: string
  /** 归属 Operator（可选，有则做校验） */
  operatorPubkey?: string
  /** Agent 级默认可见性 */
  default: VisibilityDecision
}

/** 单条经验级覆盖 */
export interface IntentVisibilityOverride {
  visibility: VisibilityDecision
}

export interface ResolveInput {
  operatorConfig: OperatorVisibilityConfig | null
  agentConfig: AgentVisibilityConfig | null
  intentOverride: IntentVisibilityOverride | null
}

export interface ResolveResult {
  visibility: VisibilityDecision
  source: VisibilitySource
  reason: string
}

// ============================================================
// 解析器
// ============================================================

export interface VisibilityResolver {
  resolve(input: ResolveInput): ResolveResult
}

export function createVisibilityResolver(): VisibilityResolver {
  return {
    resolve(input: ResolveInput): ResolveResult {
      const { operatorConfig, agentConfig, intentOverride } = input

      // 1. 经验级最高优先
      if (intentOverride !== null) {
        return {
          visibility: intentOverride.visibility,
          source: 'intent',
          reason: `单条经验明确设置为 ${intentOverride.visibility}`,
        }
      }

      // 2. Agent 级（校验归属）
      if (agentConfig !== null) {
        // 如果有 Operator 配置，校验 Agent 的 operatorPubkey 是否匹配
        if (
          operatorConfig !== null &&
          agentConfig.operatorPubkey !== undefined &&
          agentConfig.operatorPubkey !== operatorConfig.operatorPubkey
        ) {
          // 不匹配：Agent 设置被忽略，回退到 Operator 级
          return {
            visibility: operatorConfig.default,
            source: 'operator',
            reason: `Agent 的 operatorPubkey 不匹配，忽略 Agent 设置，使用 Operator 默认值 ${operatorConfig.default}`,
          }
        }

        return {
          visibility: agentConfig.default,
          source: 'agent',
          reason: `Agent 级默认值为 ${agentConfig.default}`,
        }
      }

      // 3. Operator 级
      if (operatorConfig !== null) {
        return {
          visibility: operatorConfig.default,
          source: 'operator',
          reason: `Operator 级默认值为 ${operatorConfig.default}`,
        }
      }

      // 4. 系统默认
      return {
        visibility: 'public',
        source: 'default',
        reason: '未配置任何可见性，系统默认 public',
      }
    },
  }
}
