/**
 * D3：三层可见性开关
 *
 * Operator → Agent → 经验三层覆盖控制
 * 优先级：经验级 > Agent 级 > Operator 级 > 自动分类默认值
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  VisibilityResolver,
  createVisibilityResolver,
  OperatorVisibilityConfig,
  AgentVisibilityConfig,
  IntentVisibilityOverride,
} from '../src/visibility.js'

// ============================================================
// 基础优先级
// ============================================================

describe('三层优先级', () => {
  let resolver: VisibilityResolver

  beforeEach(() => {
    resolver = createVisibilityResolver()
  })

  it('Operator 关闭 → 所有经验 private', () => {
    const operatorConfig: OperatorVisibilityConfig = {
      operatorPubkey: 'op-pub-key',
      default: 'private',
    }
    const result = resolver.resolve({
      operatorConfig,
      agentConfig: null,
      intentOverride: null,
    })
    expect(result.visibility).toBe('private')
    expect(result.source).toBe('operator')
  })

  it('Operator 开启，Agent 关闭 → Agent 的经验 private', () => {
    const operatorConfig: OperatorVisibilityConfig = {
      operatorPubkey: 'op-pub-key',
      default: 'public',
    }
    const agentConfig: AgentVisibilityConfig = {
      agentPubkey: 'agent-pub-key',
      default: 'private',
    }
    const result = resolver.resolve({
      operatorConfig,
      agentConfig,
      intentOverride: null,
    })
    expect(result.visibility).toBe('private')
    expect(result.source).toBe('agent')
  })

  it('Operator/Agent 都开启，单条经验覆盖 private', () => {
    const operatorConfig: OperatorVisibilityConfig = {
      operatorPubkey: 'op-pub-key',
      default: 'public',
    }
    const agentConfig: AgentVisibilityConfig = {
      agentPubkey: 'agent-pub-key',
      default: 'public',
    }
    const intentOverride: IntentVisibilityOverride = {
      visibility: 'private',
    }
    const result = resolver.resolve({
      operatorConfig,
      agentConfig,
      intentOverride,
    })
    expect(result.visibility).toBe('private')
    expect(result.source).toBe('intent')
  })

  it('单条经验强制 public，即使 Operator 设为 private', () => {
    const operatorConfig: OperatorVisibilityConfig = {
      operatorPubkey: 'op-pub-key',
      default: 'private',
    }
    const agentConfig: AgentVisibilityConfig = {
      agentPubkey: 'agent-pub-key',
      default: 'private',
    }
    const intentOverride: IntentVisibilityOverride = {
      visibility: 'public',
    }
    const result = resolver.resolve({
      operatorConfig,
      agentConfig,
      intentOverride,
    })
    expect(result.visibility).toBe('public')
    expect(result.source).toBe('intent')
  })

  it('全都未设置 → 默认 public', () => {
    const result = resolver.resolve({
      operatorConfig: null,
      agentConfig: null,
      intentOverride: null,
    })
    expect(result.visibility).toBe('public')
    expect(result.source).toBe('default')
  })
})

// ============================================================
// 级联：Agent 属于 Operator 的校验
// ============================================================

describe('Operator 管辖校验', () => {
  it('Agent 的 operatorPubkey 必须匹配 Operator', () => {
    const resolver = createVisibilityResolver()
    const operatorConfig: OperatorVisibilityConfig = {
      operatorPubkey: 'op-A',
      default: 'public',
    }
    const agentConfig: AgentVisibilityConfig = {
      agentPubkey: 'agent-X',
      operatorPubkey: 'op-B', // 不匹配
      default: 'private',
    }
    // 不匹配时 Agent 设置应被忽略，回退到 Operator 级
    const result = resolver.resolve({
      operatorConfig,
      agentConfig,
      intentOverride: null,
    })
    expect(result.visibility).toBe('public')
    expect(result.source).toBe('operator')
  })

  it('Agent operatorPubkey 匹配 → Agent 设置生效', () => {
    const resolver = createVisibilityResolver()
    const operatorConfig: OperatorVisibilityConfig = {
      operatorPubkey: 'op-A',
      default: 'public',
    }
    const agentConfig: AgentVisibilityConfig = {
      agentPubkey: 'agent-X',
      operatorPubkey: 'op-A', // 匹配
      default: 'private',
    }
    const result = resolver.resolve({
      operatorConfig,
      agentConfig,
      intentOverride: null,
    })
    expect(result.visibility).toBe('private')
    expect(result.source).toBe('agent')
  })

  it('无 Operator 配置时 Agent 设置独立生效', () => {
    const resolver = createVisibilityResolver()
    const agentConfig: AgentVisibilityConfig = {
      agentPubkey: 'agent-X',
      default: 'private',
    }
    const result = resolver.resolve({
      operatorConfig: null,
      agentConfig,
      intentOverride: null,
    })
    expect(result.visibility).toBe('private')
    expect(result.source).toBe('agent')
  })
})

// ============================================================
// 批量解析（publish 时场景）
// ============================================================

describe('批量场景', () => {
  it('多条经验：各有不同 override', () => {
    const resolver = createVisibilityResolver()
    const operatorConfig: OperatorVisibilityConfig = {
      operatorPubkey: 'op-A',
      default: 'public',
    }
    const agentConfig: AgentVisibilityConfig = {
      agentPubkey: 'agent-X',
      operatorPubkey: 'op-A',
      default: 'public',
    }

    const results = [
      resolver.resolve({ operatorConfig, agentConfig, intentOverride: null }),
      resolver.resolve({ operatorConfig, agentConfig, intentOverride: { visibility: 'private' } }),
      resolver.resolve({ operatorConfig, agentConfig, intentOverride: { visibility: 'public' } }),
    ]

    expect(results[0].visibility).toBe('public')
    expect(results[1].visibility).toBe('private')
    expect(results[2].visibility).toBe('public')
  })
})

// ============================================================
// 返回结构
// ============================================================

describe('返回结构', () => {
  it('包含 visibility + source + reason', () => {
    const resolver = createVisibilityResolver()
    const result = resolver.resolve({
      operatorConfig: { operatorPubkey: 'op-A', default: 'private' },
      agentConfig: null,
      intentOverride: null,
    })
    expect(result.visibility).toBeDefined()
    expect(result.source).toBeDefined()
    expect(result.reason).toBeDefined()
  })
})
