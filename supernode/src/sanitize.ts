/**
 * Serendip Supernode — 本地脱敏引擎（D1）
 *
 * 数据发布前本地运行，无需网络。
 * 高风险 → block（整条经验不发布）
 * 中风险 → redact（替换占位符后可发布）
 * 干净   → pass
 */

// ============================================================
// 类型定义
// ============================================================

export interface SanitizeInput {
  tried?: string
  learned?: string
  context?: string
  what?: string
  outcome_detail?: string
  [key: string]: string | undefined
}

export type SanitizeAction = 'pass' | 'redact' | 'block'

export interface SanitizeResult {
  action: SanitizeAction
  /** block 或 redact 时的原因说明 */
  reason?: string
  /** pass 或 redact 后的内容（block 时可能为 undefined） */
  content?: SanitizeInput
  /** redact 时列出被替换的字段 */
  redacted_fields?: string[]
}

// ============================================================
// 高风险模式（block）
// ============================================================

interface HighRiskPattern {
  label: string
  regex: RegExp
}

const HIGH_RISK_PATTERNS: HighRiskPattern[] = [
  // OpenAI / Anthropic / 通用 sk-xxx 类型 API key
  {
    label: 'API key',
    regex: /\bsk-[a-zA-Z0-9_-]{16,}/,
  },
  // AWS Access Key ID
  {
    label: 'AWS Access Key',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  // AWS Secret Access Key 关键词组合
  {
    label: 'AWS Secret Key',
    regex: /aws_secret_access_key\s*=\s*[a-zA-Z0-9/+]{20,}/i,
  },
  // GitHub PAT (ghp_ / gho_ / github_pat_)
  {
    label: 'GitHub token',
    regex: /\b(ghp_|gho_|github_pat_)[a-zA-Z0-9_]{20,}/,
  },
  // Bearer token（JWT 或长随机串）
  {
    label: 'Bearer token',
    regex: /Bearer\s+[a-zA-Z0-9\-_.]{40,}/i,
  },
  // RSA/EC/通用私钥 PEM 头
  {
    label: 'private key',
    regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----/i,
  },
  // 数据库连接串（含用户名:密码@）
  {
    label: 'connection string',
    regex: /(?:postgresql|mysql|mongodb|redis):\/\/[^:]+:[^@]{4,}@/i,
  },
  // 通用 token / secret 赋值（很长的随机串）
  {
    label: 'API key',
    regex: /(?:token|secret|password|passwd|api_key)\s*=\s*[a-zA-Z0-9+/]{32,}/i,
  },
]

// ============================================================
// 中风险模式（redact）
// ============================================================

interface MediumRiskPattern {
  label: string
  regex: RegExp
  placeholder: string
}

const MEDIUM_RISK_PATTERNS: MediumRiskPattern[] = [
  // 内网 IP（192.168.x.x / 10.x.x.x / 172.16-31.x.x）+ 可能的端口和路径
  {
    label: 'private_url',
    regex: /https?:\/\/(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/[^\s]*)?\b/g,
    placeholder: '[PRIVATE_URL]',
  },
  // 内网 IP（纯 IP 不带协议）192.168 / 10.x
  {
    label: 'private_ip',
    regex: /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    placeholder: '[PRIVATE_IP]',
  },
  // 邮箱地址
  {
    label: 'email',
    regex: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    placeholder: '[EMAIL]',
  },
  // 手机号（中国大陆 11 位，以 1[3-9] 开头）
  {
    label: 'phone',
    regex: /\b1[3-9]\d{9}\b/g,
    placeholder: '[PHONE]',
  },
  // Unix 绝对路径（/home/xxx / /Users/xxx / /root/xxx 等）
  {
    label: 'path',
    regex: /\/(?:home|Users|root|etc|var|opt|srv|data)\/[^\s"']+/g,
    placeholder: '[PATH]',
  },
  // Windows 绝对路径（C:\Users\xxx 风格）
  {
    label: 'path',
    regex: /[A-Za-z]:\\(?:[^\s\\/"']+\\)+[^\s\\/"']*/g,
    placeholder: '[PATH]',
  },
]

// ============================================================
// 核心逻辑
// ============================================================

/**
 * 检查单个字段是否触发高风险
 */
function checkHighRisk(text: string): { hit: boolean; label?: string } {
  for (const { label, regex } of HIGH_RISK_PATTERNS) {
    if (regex.test(text)) {
      return { hit: true, label }
    }
  }
  return { hit: false }
}

/**
 * 对单个字段做中风险替换
 * 返回替换后的文本 + 是否有替换
 */
function redactField(text: string): { result: string; changed: boolean } {
  let result = text
  let changed = false

  for (const { regex, placeholder } of MEDIUM_RISK_PATTERNS) {
    // 重置 lastIndex（因为使用 /g 标志）
    regex.lastIndex = 0
    if (regex.test(result)) {
      regex.lastIndex = 0
      result = result.replace(regex, placeholder)
      changed = true
    }
    regex.lastIndex = 0
  }

  return { result, changed }
}

/**
 * 主脱敏函数
 *
 * 遍历所有字段：
 * 1. 先做高风险检查（任一字段触发 → block 整条）
 * 2. 再做中风险替换（逐字段替换占位符）
 */
export function sanitize(input: SanitizeInput): SanitizeResult {
  // Step 1：高风险检查（任一字段触发 → block）
  for (const [, value] of Object.entries(input)) {
    if (!value) continue
    const { hit, label } = checkHighRisk(value)
    if (hit) {
      return {
        action: 'block',
        reason: `${label ?? 'sensitive content'} detected — 不发布此条经验`,
      }
    }
  }

  // Step 2：中风险替换
  const redacted: SanitizeInput = {}
  const redacted_fields: string[] = []

  for (const [key, value] of Object.entries(input)) {
    if (!value) {
      redacted[key] = value
      continue
    }
    const { result, changed } = redactField(value)
    redacted[key] = result
    if (changed) {
      redacted_fields.push(key)
    }
  }

  if (redacted_fields.length > 0) {
    return {
      action: 'redact',
      reason: `中风险内容已替换：${redacted_fields.join(', ')}`,
      content: redacted,
      redacted_fields,
    }
  }

  // Step 3：干净通过
  return {
    action: 'pass',
    content: input,
  }
}
