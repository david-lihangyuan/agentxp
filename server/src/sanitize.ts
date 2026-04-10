/**
 * 脱敏约束模块 — 发布前敏感信息检测
 *
 * 社区反馈 @hexxspark：Agent 发布经验时应检测 API key、密码、内部 URL 等敏感信息并警告。
 * 策略：检测 + 警告，不自动阻止（给发布者选择权）。
 *
 * 用法：
 *   const result = detectSensitiveContent(text);
 *   if (result.found) { ... 在响应中附加 warnings ... }
 */

export interface SensitiveMatch {
  /** 匹配到的敏感信息类型 */
  type: 'api_key' | 'password' | 'token' | 'private_url' | 'email' | 'ip_address' | 'private_key' | 'connection_string';
  /** 匹配到的内容（已部分遮蔽） */
  masked: string;
  /** 在原文中的大致位置 */
  field: string;
}

export interface SanitizeResult {
  found: boolean;
  matches: SensitiveMatch[];
  warnings: string[];
}

// === 检测规则 ===

interface DetectionRule {
  type: SensitiveMatch['type'];
  pattern: RegExp;
  description: string;
  /** 最小匹配长度（避免误报） */
  minLength?: number;
}

const DETECTION_RULES: DetectionRule[] = [
  // API Keys — 常见平台格式
  { type: 'api_key', pattern: /sk-[a-zA-Z0-9]{20,}/g, description: 'OpenAI API key' },
  { type: 'api_key', pattern: /sk-proj-[a-zA-Z0-9_-]{20,}/g, description: 'OpenAI project key' },
  { type: 'api_key', pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, description: 'Anthropic API key' },
  { type: 'api_key', pattern: /AIza[a-zA-Z0-9_-]{35}/g, description: 'Google API key' },
  { type: 'api_key', pattern: /ghp_[a-zA-Z0-9]{36}/g, description: 'GitHub personal access token' },
  { type: 'api_key', pattern: /gho_[a-zA-Z0-9]{36}/g, description: 'GitHub OAuth token' },
  { type: 'api_key', pattern: /github_pat_[a-zA-Z0-9_]{22,}/g, description: 'GitHub fine-grained PAT' },
  { type: 'api_key', pattern: /glpat-[a-zA-Z0-9_-]{20,}/g, description: 'GitLab personal access token' },
  { type: 'api_key', pattern: /xoxb-[a-zA-Z0-9-]{20,}/g, description: 'Slack bot token' },
  { type: 'api_key', pattern: /xoxp-[a-zA-Z0-9-]{20,}/g, description: 'Slack user token' },
  { type: 'api_key', pattern: /AKIA[A-Z0-9]{16}/g, description: 'AWS access key' },
  { type: 'api_key', pattern: /sq0atp-[a-zA-Z0-9_-]{22}/g, description: 'Square access token' },
  { type: 'api_key', pattern: /pk_(test|live)_[a-zA-Z0-9]{20,}/g, description: 'Stripe publishable key' },
  { type: 'api_key', pattern: /sk_(test|live)_[a-zA-Z0-9]{20,}/g, description: 'Stripe secret key' },
  { type: 'api_key', pattern: /sxp_[a-zA-Z0-9]{32,}/g, description: 'AgentXP API key' },

  // Tokens — Bearer / JWT / 通用格式
  { type: 'token', pattern: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g, description: 'JWT token' },
  { type: 'token', pattern: /Bearer\s+[a-zA-Z0-9_.-]{20,}/g, description: 'Bearer token in header' },

  // 密码模式 — 配置文件 / 环境变量里的密码
  { type: 'password', pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi, description: '密码赋值', minLength: 12 },
  { type: 'password', pattern: /(?:PASSWORD|PASSWD|SECRET|DB_PASS|MYSQL_ROOT_PASSWORD|POSTGRES_PASSWORD)\s*=\s*[^\s]{8,}/g, description: '环境变量密码' },

  // 私钥
  { type: 'private_key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, description: '私钥头部' },

  // 连接字符串（含密码）
  { type: 'connection_string', pattern: /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^:]+:[^@]+@[^\s]+/g, description: '带密码的连接字符串' },

  // 内网/私有 URL
  { type: 'private_url', pattern: /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})[:\/?][^\s]*/g, description: '内网 URL' },

  // IP 地址（单独出现的公网 IP，可能是服务器地址）
  { type: 'ip_address', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b(?::\d{2,5})?/g, description: '可能的服务器 IP 地址' },

  // 邮箱（出现在技术内容中可能是意外泄露）
  { type: 'email', pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, description: '邮箱地址' },
];

// 常见误报白名单
interface FalsePositiveRule {
  pattern: RegExp;
  /** 只对这些 type 生效（不指定 = 对所有类型生效） */
  types?: SensitiveMatch['type'][];
}

const FALSE_POSITIVE_RULES: FalsePositiveRule[] = [
  // 文档示例中的占位符
  { pattern: /YOUR_API_KEY/i },
  { pattern: /YOUR_TOKEN/i },
  { pattern: /your-api-key/i },
  { pattern: /placeholder/i },
  { pattern: /xxx+/i },
  // 示例邮箱/URL（只对 email 和 private_url 生效）
  { pattern: /example\.com/i, types: ['email', 'private_url'] },
  { pattern: /test@example/i, types: ['email'] },
  { pattern: /user@example/i, types: ['email'] },
  // 示例 IP
  { pattern: /^0\.0\.0\.0$/ },
  { pattern: /^127\.0\.0\.1$/ },
  { pattern: /^localhost$/ },
  // 文档/教程中的示例 key
  { pattern: /sk-xxxxxxxx/i },
  { pattern: /sk-your/i },
  { pattern: /sk-replace/i },
];

/**
 * 遮蔽敏感内容：显示前4字符 + ... + 后2字符
 */
function maskSensitive(value: string): string {
  if (value.length <= 8) return '***';
  return value.slice(0, 4) + '...' + value.slice(-2);
}

/**
 * 检查匹配是否是误报（文档示例、占位符等）
 */
function isFalsePositive(match: string, type: SensitiveMatch['type']): boolean {
  return FALSE_POSITIVE_RULES.some(rule => {
    if (rule.types && !rule.types.includes(type)) return false;
    return rule.pattern.test(match);
  });
}

/**
 * 检测文本中的敏感信息
 */
function detectInText(text: string, field: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  const seen = new Set<string>(); // 去重

  for (const rule of DETECTION_RULES) {
    // 重置 lastIndex（因为用了 /g 标志）
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = rule.pattern.exec(text)) !== null) {
      const value = m[0];

      // 长度检查
      if (rule.minLength && value.length < rule.minLength) continue;

      // 误报检查
      if (isFalsePositive(value, rule.type)) continue;

      // 去重
      const key = `${rule.type}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      matches.push({
        type: rule.type,
        masked: maskSensitive(value),
        field,
      });
    }
  }

  return matches;
}

/**
 * 检测经验内容中的敏感信息
 *
 * 检查所有文本字段：what, context, tried, outcome_detail, learned
 * 以及 executable 中的 code 和 description
 *
 * @returns SanitizeResult — found=true 时附带 warnings 数组
 */
export function detectSensitiveContent(fields: {
  what?: string;
  context?: string;
  tried?: string;
  outcome_detail?: string;
  learned?: string;
  executable?: Array<{ code?: string; description?: string }>;
}): SanitizeResult {
  const allMatches: SensitiveMatch[] = [];

  // 检查核心字段
  if (fields.what) allMatches.push(...detectInText(fields.what, 'core.what'));
  if (fields.context) allMatches.push(...detectInText(fields.context, 'core.context'));
  if (fields.tried) allMatches.push(...detectInText(fields.tried, 'core.tried'));
  if (fields.outcome_detail) allMatches.push(...detectInText(fields.outcome_detail, 'core.outcome_detail'));
  if (fields.learned) allMatches.push(...detectInText(fields.learned, 'core.learned'));

  // 检查可执行内容
  if (fields.executable) {
    fields.executable.forEach((exec, i) => {
      if (exec.code) allMatches.push(...detectInText(exec.code, `executable[${i}].code`));
      if (exec.description) allMatches.push(...detectInText(exec.description, `executable[${i}].description`));
    });
  }

  // 生成人类可读的警告信息
  const warnings: string[] = [];
  if (allMatches.length > 0) {
    // 按类型分组
    const byType = new Map<string, SensitiveMatch[]>();
    for (const match of allMatches) {
      const list = byType.get(match.type) || [];
      list.push(match);
      byType.set(match.type, list);
    }

    const typeLabels: Record<string, string> = {
      api_key: 'API 密钥',
      password: '密码',
      token: '令牌',
      private_url: '内网 URL',
      email: '邮箱地址',
      ip_address: 'IP 地址',
      private_key: '私钥',
      connection_string: '连接字符串',
    };

    for (const [type, matches] of byType) {
      const label = typeLabels[type] || type;
      const fields = [...new Set(matches.map(m => m.field))];
      warnings.push(`⚠️ 检测到可能的${label}（${fields.join(', ')}中）：${matches.map(m => m.masked).join(', ')}。发布后所有人可见，请确认是否需要脱敏`);
    }
  }

  return {
    found: allMatches.length > 0,
    matches: allMatches,
    warnings,
  };
}

/**
 * 区分高危和低危匹配
 * 高危：API key、密码、私钥、token、连接字符串 — 泄露直接可利用
 * 低危：邮箱、IP 地址、内网 URL — 可能是误报或无害
 */
export function classifyRisk(matches: SensitiveMatch[]): {
  high: SensitiveMatch[];
  low: SensitiveMatch[];
} {
  const high: SensitiveMatch[] = [];
  const low: SensitiveMatch[] = [];

  for (const match of matches) {
    if (['api_key', 'password', 'token', 'private_key', 'connection_string'].includes(match.type)) {
      high.push(match);
    } else {
      low.push(match);
    }
  }

  return { high, low };
}
