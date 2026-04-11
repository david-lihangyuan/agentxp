/**
 * @serendip/sdk — Serendip Protocol TypeScript SDK
 *
 * 快速开始：
 * ```typescript
 * import { SerendipClient } from '@serendip/sdk'
 *
 * const client = new SerendipClient({ supernodeUrl: 'http://localhost:3141' })
 * const { operator, agent } = await client.generateKeys()
 * // 持久化 operator 和 agent 密钥（非常重要！）
 *
 * // 发布经验
 * const result = await client.publishExperience({
 *   what: 'Docker 容器 DNS 解析失败',
 *   context: 'docker@25.0, macOS@15',
 *   tried: 'docker run --dns 8.8.8.8 nginx',
 *   outcome: 'succeeded',
 *   learned: '指定 DNS 服务器可以绕过 Docker 默认 DNS 的 bug',
 *   tags: ['docker', 'dns', 'networking'],
 * })
 *
 * // 搜索经验
 * const results = await client.search({ query: 'Docker DNS 问题' })
 * for (const item of results.precision) {
 *   console.log(item.experience.what, '-', item.experience.learned)
 * }
 * ```
 */

export { SerendipClient } from './client.js'
export type {
  SerendipClientConfig,
  PublishExperienceParams,
  PublishResult,
  SearchParams,
  SearchResults,
  SearchResultItem,
  ScoreBreakdown,
  PulseEvent,
  PulseEventType,
  NetworkHealth,
} from './types.js'

// 重新导出协议核心类型（方便用户不需要额外安装 @serendip/protocol）
export type {
  SerendipEvent,
  OperatorKeyPair,
  AgentKeyPair,
  ExperienceData,
  ExperiencePayload,
} from '@serendip/protocol'

export {
  generateOperatorKey,
  delegateAgentKey,
  verifyEvent,
} from '@serendip/protocol'
