/**
 * Serendip Supernode — 内容自动分类（D2）
 *
 * 规则优先（0 token）：含内部关键词 → private
 * 返回 'public' | 'private' | 'uncertain'
 *
 * LLM 兜底（可选，每天两次批量）：判断是否有通用价值
 * 当前实现：规则层完整，LLM 层预留接口
 */

// ============================================================
// 类型定义
// ============================================================

export type VisibilityDecision = 'public' | 'private' | 'uncertain'
export type ClassifyMethod = 'rule' | 'llm' | 'default'

export interface ClassifyInput {
  tried?: string
  learned?: string
  context?: string
  what?: string
  tags?: string[]
  [key: string]: string | string[] | undefined
}

export interface VisibilityClassification {
  visibility: VisibilityDecision
  method: ClassifyMethod
  reason: string
  /** LLM 方法时的置信度（0-1），规则方法为 1 */
  confidence?: number
}

// ============================================================
// 私密关键词（规则层）
// ============================================================

/** 文本内容中触发 private 的关键词 */
const PRIVATE_KEYWORDS_EN = [
  'internal',
  'confidential',
  'proprietary',
  'private',
  'secret',
  'classified',
  // 具体平台（B2B / 企业专用）
  'salesforce',
  'workday',
  'sap',
  'oracle',
  'jira',       // 可能是内部 Jira
  'confluence',  // 内部 wiki
]

/** 中文私密关键词 */
const PRIVATE_KEYWORDS_ZH = [
  '内部',
  '内网',
  '公司',
  '机密',
  '保密',
  '专有',
]

/** tags 中触发 private 的关键词 */
const PRIVATE_TAGS = ['private', 'internal', 'confidential', 'proprietary', '内部', '机密']

// ============================================================
// 公共技术关键词（优先于私密词，提高精准度）
// ============================================================

/** 包含这些词的内容倾向于通用技术，除非同时含私密词 */
const PUBLIC_TECH_KEYWORDS = [
  // 通用工具
  'docker', 'kubernetes', 'k8s', 'nginx', 'apache',
  'npm', 'yarn', 'pip', 'cargo', 'brew',
  'git ', 'github', 'gitlab', 'bitbucket',
  'ssh-keygen', 'openssl',
  'vitest', 'jest', 'pytest', 'mocha',
  'typescript', 'javascript', 'python', 'rust', 'golang',
  'react', 'vue', 'svelte', 'next.js', 'nuxt',
  // 公共 API / 服务
  'openai', 'anthropic', 'cloudflare', 'vercel', 'netlify',
  'aws s3', 'aws lambda', 'gcp', 'azure',
  // 通用运维
  'systemd', 'pm2', 'supervisor',
  'postgresql', 'mysql', 'redis', 'mongodb',
  'terraform', 'ansible', 'puppet',
]

// ============================================================
// 核心分类逻辑
// ============================================================

/**
 * 合并输入文本字段为单个字符串（用于关键词匹配）
 */
function extractText(input: ClassifyInput): string {
  const fields = ['tried', 'learned', 'context', 'what', 'outcome_detail']
  return fields
    .map((f) => (input[f] as string | undefined) ?? '')
    .join(' ')
    .toLowerCase()
}

/**
 * 规则层分类
 *
 * 返回 null 表示规则无法判断（交给 LLM 或默认值）
 */
function classifyByRule(input: ClassifyInput): VisibilityClassification | null {
  const text = extractText(input)
  const tags = (input.tags ?? []).map((t) => t.toLowerCase())

  // 1. 检查 tags 中的私密标记
  for (const tag of tags) {
    if (PRIVATE_TAGS.includes(tag)) {
      return {
        visibility: 'private',
        method: 'rule',
        reason: `tag "${tag}" 表明这是私有内容`,
        confidence: 1,
      }
    }
  }

  // 2. 优先检查公共技术关键词（防止 private key / private repo 等通用词误判）
  const hasPublicTech = PUBLIC_TECH_KEYWORDS.some((kw) => text.includes(kw))

  // 3. 检查英文私密关键词（public tech 词优先：有公共技术词时 private/secret 词不触发）
  for (const kw of PRIVATE_KEYWORDS_EN) {
    if (text.includes(kw)) {
      // 'private' 在有公共技术上下文时（如 ssh-keygen、openssl）不触发
      if ((kw === 'private' || kw === 'secret') && hasPublicTech) {
        continue
      }
      return {
        visibility: 'private',
        method: 'rule',
        reason: `内容含关键词 "${kw}"，判定为私有`,
        confidence: 1,
      }
    }
  }

  // 4. 检查中文私密关键词
  const fullText = [
    input.tried ?? '',
    input.learned ?? '',
    input.context ?? '',
    input.what ?? '',
  ].join(' ')
  for (const kw of PRIVATE_KEYWORDS_ZH) {
    if (fullText.includes(kw)) {
      return {
        visibility: 'private',
        method: 'rule',
        reason: `内容含关键词 "${kw}"，判定为私有`,
        confidence: 1,
      }
    }
  }

  // 5. 公共技术关键词 → public
  if (hasPublicTech) {
    const matchedKw = PUBLIC_TECH_KEYWORDS.find((kw) => text.includes(kw))!
    return {
      visibility: 'public',
      method: 'rule',
      reason: `内容含通用技术关键词 "${matchedKw}"，判定为公开`,
      confidence: 0.9,
    }
  }

  // 规则无法判断
  return null
}

// ============================================================
// LLM 兜底（预留接口，当前返回 uncertain）
// ============================================================

async function classifyByLLM(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _input: ClassifyInput,
): Promise<VisibilityClassification> {
  // TODO: 批量模式，每天两次。当前返回 uncertain（人工或后续处理决策）
  return {
    visibility: 'uncertain',
    method: 'llm',
    reason: 'LLM 分类器暂未启用，标记为待分类',
    confidence: 0,
  }
}

// ============================================================
// 主分类函数
// ============================================================

/**
 * 自动分类内容可见性
 *
 * 优先级：规则 → LLM → 默认 public
 */
export async function classifyVisibility(
  input: ClassifyInput,
): Promise<VisibilityClassification> {
  // 规则优先
  const ruleResult = classifyByRule(input)
  if (ruleResult !== null) {
    return ruleResult
  }

  // LLM 兜底（当前实现为 uncertain）
  const llmResult = await classifyByLLM(input)
  if (llmResult.visibility !== 'uncertain') {
    return llmResult
  }

  // 默认：无法判断的规则层内容 → public（降低误判率）
  return {
    visibility: 'uncertain',
    method: 'default',
    reason: '规则和 LLM 均无法判断，标记为待分类',
    confidence: 0,
  }
}
