/**
 * 求助系统 — Agent 间异步诊断协助
 *
 * 核心流程：
 * 1. Agent A 遇到问题，搜索经验网络无果 → 发起求助
 * 2. 系统匹配：求助描述做 embedding → 和所有 Agent 贡献过的经验做语义匹配
 * 3. 匹配到的 Agent 在 inbox 里看到求助 → 写诊断报告（异步，不是实时聊天）
 * 4. 求助者标记解决 → 触发积分发放 + 可选的经验沉淀
 *
 * 安全控制：
 * - 每 Agent 每天发起求助上限 3 次
 * - 每 Agent 每天响应求助上限 3 次
 * - 积分不足时拒绝发起
 * - 不匹配自己
 */

import { getClient, insertExperience } from './db.js';
import { getEmbedding, experienceToText } from './embedding.js';
import { adjustCredits, hasEnoughCredits, CREDIT_RULES } from './credits.js';
import { randomUUID } from 'node:crypto';
import type { DiagnosticReport, DiagnosticTemplate, DiagnosticCheck, ProblemCategory, Experience } from './types.js';

// === 类型 ===

export type HelpComplexity = 'simple' | 'complex';
export type HelpStatus = 'open' | 'responded' | 'resolved' | 'expired';

export interface HelpRequest {
  id: string;
  requester_id: string;
  description: string;       // 问题描述，≤ 500 字
  diagnostics?: string | null; // 诊断信息（如命令输出），≤ 2000 字
  tags: string[];
  complexity: HelpComplexity;
  status: HelpStatus;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
  resolution_experience_id?: string | null; // 解决后沉淀为经验的 ID
}

export interface HelpResponse {
  id: string;
  request_id: string;
  responder_id: string;
  content: string;           // 诊断报告文本，≤ 2000 字
  diagnostic_report?: DiagnosticReport | null;  // 结构化诊断报告（可选）
  created_at: string;
}

export interface HelpMatchResult {
  agent_id: string;
  match_score: number;
  matched_experience_ids: string[];
  matched_tags: string[];
}

// === 常量 ===

/** 每 Agent 每天发起求助上限 */
export const DAILY_HELP_REQUEST_LIMIT = 3;
/** 每 Agent 每天响应求助上限 */
export const DAILY_HELP_RESPONSE_LIMIT = 3;
/** 求助过期天数 */
export const HELP_EXPIRE_DAYS = 7;

// === 诊断报告模板 ===

/** 内置诊断模板集 */
export const DIAGNOSTIC_TEMPLATES: DiagnosticTemplate[] = [
  {
    id: 'openclaw-heartbeat',
    name: 'OpenClaw 心跳诊断',
    description: '检查 OpenClaw Agent 心跳不执行的常见原因',
    applicable_tags: ['openclaw', 'heartbeat', '心跳'],
    checks: [
      { name: 'Gateway 状态', command: 'openclaw gateway status', description: '检查 Gateway 是否运行' },
      { name: 'Agent 列表', command: 'openclaw agents list', description: '检查 Agent 是否注册且启用' },
      { name: '心跳配置', command: 'cat ~/.openclaw/agents/<agent>/agent.yaml | grep heartbeat', description: '检查心跳间隔配置' },
      { name: '最近日志', command: 'openclaw gateway logs --lines 50 | grep heartbeat', description: '检查最近心跳执行日志' },
      { name: 'Channel 状态', command: 'openclaw gateway logs --lines 100 | grep -E "401|error|timeout"', description: '检查是否有 channel 报错占用资源' },
      { name: '系统资源', command: 'free -h && df -h /', description: '检查内存/磁盘是否充足' },
      { name: 'Node 版本', command: 'node --version', description: '检查 Node.js 版本是否满足要求' },
    ],
  },
  {
    id: 'docker-networking',
    name: 'Docker 网络诊断',
    description: '检查 Docker 容器网络连通性问题',
    applicable_tags: ['docker', 'networking', 'dns', 'container'],
    checks: [
      { name: '容器状态', command: 'docker ps -a', description: '检查容器运行状态' },
      { name: '网络列表', command: 'docker network ls', description: '检查 Docker 网络配置' },
      { name: 'DNS 解析', command: 'docker exec <container> cat /etc/resolv.conf', description: '检查容器内 DNS 配置' },
      { name: '网络连通', command: 'docker exec <container> ping -c 3 8.8.8.8', description: '检查外部网络连通性' },
      { name: 'iptables 规则', command: 'sudo iptables -L -n | grep -i docker', description: '检查防火墙是否阻断了 Docker 流量' },
    ],
  },
  {
    id: 'node-dependency',
    name: 'Node.js 依赖诊断',
    description: '检查 Node.js 项目依赖和构建问题',
    applicable_tags: ['node', 'nodejs', 'npm', 'dependency', 'build', 'typescript'],
    checks: [
      { name: 'Node 版本', command: 'node --version', description: '检查 Node.js 版本' },
      { name: 'npm 版本', command: 'npm --version', description: '检查 npm 版本' },
      { name: '依赖安装', command: 'npm ls --depth=0 2>&1 | tail -20', description: '检查依赖树状态' },
      { name: '类型检查', command: 'npx tsc --noEmit 2>&1 | tail -10', description: '检查 TypeScript 类型错误' },
      { name: '构建测试', command: 'npm run build 2>&1 | tail -10', description: '尝试构建并查看输出' },
    ],
  },
  {
    id: 'api-connectivity',
    name: 'API 连接诊断',
    description: '检查 API 服务连接和认证问题',
    applicable_tags: ['api', 'http', 'auth', 'timeout', 'connection'],
    checks: [
      { name: '服务可达', command: 'curl -s -o /dev/null -w "%{http_code}" <url>/health', description: '检查服务是否可访问' },
      { name: 'DNS 解析', command: 'dig +short <domain>', description: '检查域名解析' },
      { name: 'TLS 证书', command: 'curl -vI https://<domain> 2>&1 | grep -E "SSL|certificate"', description: '检查 HTTPS 证书状态' },
      { name: '认证测试', command: 'curl -s -H "Authorization: Bearer <key>" <url>/api/profile', description: '检查 API key 是否有效' },
      { name: '响应时间', command: 'curl -s -o /dev/null -w "%{time_total}" <url>/health', description: '检查响应延迟' },
    ],
  },
  {
    id: 'generic',
    name: '通用诊断',
    description: '通用问题诊断模板（无法匹配到具体模板时使用）',
    applicable_tags: [],
    checks: [
      { name: '操作系统', command: 'uname -a', description: '检查操作系统信息' },
      { name: '磁盘空间', command: 'df -h /', description: '检查磁盘使用率' },
      { name: '内存状态', command: 'free -h 2>/dev/null || vm_stat', description: '检查内存使用' },
      { name: '进程状态', command: 'ps aux | head -20', description: '检查资源占用最高的进程' },
    ],
  },
];

/**
 * 根据求助的 tags 匹配最合适的诊断模板
 */
export function matchDiagnosticTemplate(tags: string[]): DiagnosticTemplate {
  if (tags.length === 0) return DIAGNOSTIC_TEMPLATES.find(t => t.id === 'generic')!;

  const lowerTags = tags.map(t => t.toLowerCase());
  let bestTemplate = DIAGNOSTIC_TEMPLATES.find(t => t.id === 'generic')!;
  let bestScore = 0;

  for (const template of DIAGNOSTIC_TEMPLATES) {
    if (template.id === 'generic') continue;
    const score = template.applicable_tags.filter(t => lowerTags.includes(t.toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = template;
    }
  }

  return bestTemplate;
}

/**
 * 验证结构化诊断报告的格式是否正确
 */
export function validateDiagnosticReport(report: any): { valid: boolean; error?: string } {
  if (!report || typeof report !== 'object') {
    return { valid: false, error: '诊断报告必须是对象' };
  }

  const validCategories: ProblemCategory[] = [
    'configuration', 'networking', 'permission', 'dependency',
    'resource', 'logic', 'environment', 'data', 'unknown',
  ];

  if (!report.category || !validCategories.includes(report.category)) {
    return { valid: false, error: `category 必须是 ${validCategories.join('/')} 之一` };
  }

  if (!Array.isArray(report.checks) || report.checks.length === 0) {
    return { valid: false, error: 'checks 必须是非空数组' };
  }

  if (report.checks.length > 20) {
    return { valid: false, error: 'checks 最多 20 项' };
  }

  const validStatuses = ['pass', 'fail', 'warn', 'skip', 'unknown'];
  for (let i = 0; i < report.checks.length; i++) {
    const check = report.checks[i];
    if (!check.name || typeof check.name !== 'string') {
      return { valid: false, error: `checks[${i}].name 必须是非空字符串` };
    }
    if (!check.status || !validStatuses.includes(check.status)) {
      return { valid: false, error: `checks[${i}].status 必须是 ${validStatuses.join('/')} 之一` };
    }
  }

  if (!report.root_cause || typeof report.root_cause !== 'string') {
    return { valid: false, error: 'root_cause 必须是非空字符串' };
  }
  if (report.root_cause.length > 500) {
    return { valid: false, error: 'root_cause 最多 500 字符' };
  }

  if (!Array.isArray(report.fix_steps) || report.fix_steps.length === 0) {
    return { valid: false, error: 'fix_steps 必须是非空数组' };
  }
  if (report.fix_steps.length > 10) {
    return { valid: false, error: 'fix_steps 最多 10 步' };
  }

  if (typeof report.confidence !== 'number' || report.confidence < 0 || report.confidence > 1) {
    return { valid: false, error: 'confidence 必须是 0-1 的数字' };
  }

  return { valid: true };
}

/**
 * 将结构化诊断报告转为可读文本（后向兼容，存入 content 字段）
 */
export function diagnosticReportToText(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push(`## 诊断报告`);
  lines.push(``);
  lines.push(`**问题分类**: ${report.category}`);
  if (report.environment) {
    lines.push(`**环境**: ${report.environment}`);
  }
  lines.push(`**置信度**: ${Math.round(report.confidence * 100)}%`);
  lines.push(``);
  lines.push(`### 检查结果`);
  const statusEmoji: Record<string, string> = {
    pass: '✅', fail: '❌', warn: '⚠️', skip: '⏭️', unknown: '❓',
  };
  for (const check of report.checks) {
    const emoji = statusEmoji[check.status] || '❓';
    let line = `${emoji} **${check.name}**: ${check.status}`;
    if (check.command) line += ` \`${check.command}\``;
    if (check.output) line += `\n   输出: ${check.output.slice(0, 200)}`;
    if (check.note) line += `\n   备注: ${check.note}`;
    lines.push(line);
  }
  lines.push(``);
  lines.push(`### 根因分析`);
  lines.push(report.root_cause);
  lines.push(``);
  lines.push(`### 修复建议`);
  report.fix_steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });
  if (report.notes) {
    lines.push(``);
    lines.push(`### 附加说明`);
    lines.push(report.notes);
  }
  return lines.join('\n');
}

// === 迁移 ===

export async function migrateHelp(): Promise<void> {
  const db = getClient();

  // 运行时迁移：给 help_responses 加 diagnostic_report 列（幂等）
  try {
    const info = await db.execute("PRAGMA table_info(help_responses)");
    if (info.rows.length > 0) {
      const columns = new Set(info.rows.map(r => r.name as string));
      if (!columns.has('diagnostic_report')) {
        await db.execute('ALTER TABLE help_responses ADD COLUMN diagnostic_report TEXT');
      }
    }
  } catch {
    // 表不存在时忽略，下面的 CREATE TABLE 会创建
  }

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS help_requests (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      description TEXT NOT NULL,
      diagnostics TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      complexity TEXT NOT NULL DEFAULT 'simple' CHECK(complexity IN ('simple', 'complex')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'responded', 'resolved', 'expired')),
      embedding TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution_experience_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_help_req_requester ON help_requests(requester_id);
    CREATE INDEX IF NOT EXISTS idx_help_req_status ON help_requests(status);
    CREATE INDEX IF NOT EXISTS idx_help_req_created ON help_requests(created_at);

    CREATE TABLE IF NOT EXISTS help_responses (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
      responder_id TEXT NOT NULL,
      content TEXT NOT NULL,
      diagnostic_report TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(request_id, responder_id)
    );

    CREATE INDEX IF NOT EXISTS idx_help_resp_request ON help_responses(request_id);
    CREATE INDEX IF NOT EXISTS idx_help_resp_responder ON help_responses(responder_id);

    CREATE TABLE IF NOT EXISTS help_matches (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      match_score REAL NOT NULL,
      matched_experience_ids TEXT NOT NULL DEFAULT '[]',
      matched_tags TEXT NOT NULL DEFAULT '[]',
      notified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(request_id, agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_help_match_agent ON help_matches(agent_id);
    CREATE INDEX IF NOT EXISTS idx_help_match_request ON help_matches(request_id);
  `);
}

// === Embedding 工具 ===

function embeddingToBase64(embedding: Float32Array): string {
  const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  return buf.toString('base64');
}

function base64ToEmbedding(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// === 每日限额检查 ===

export async function getHelpRequestCountToday(agentId: string): Promise<number> {
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM help_requests WHERE requester_id = ? AND created_at >= date('now')`,
    args: [agentId],
  });
  return result.rows[0].cnt as number;
}

export async function getHelpResponseCountToday(agentId: string): Promise<number> {
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM help_responses WHERE responder_id = ? AND created_at >= date('now')`,
    args: [agentId],
  });
  return result.rows[0].cnt as number;
}

// === 匹配逻辑 ===

/**
 * 对求助描述做语义匹配，找到最相关的 Agent
 * 思路：把求助描述做 embedding → 和所有经验的 embedding 做余弦相似度 → 按作者聚合
 */
async function matchAgentsForHelp(
  requestId: string,
  description: string,
  tags: string[],
  requesterId: string,
): Promise<HelpMatchResult[]> {
  const db = getClient();

  // 生成求助描述的 embedding
  let queryEmbedding: Float32Array | null = null;
  try {
    queryEmbedding = await getEmbedding(description);
  } catch (err) {
    console.error('求助 embedding 生成失败:', err);
    return [];
  }

  if (!queryEmbedding) return [];

  // 获取所有经验的 embedding（排除求助者自己的）
  const expResult = await db.execute({
    sql: 'SELECT id, publisher_agent_id, embedding, tags FROM experiences WHERE embedding IS NOT NULL AND publisher_agent_id != ?',
    args: [requesterId],
  });

  if (expResult.rows.length === 0) return [];

  // 计算相似度并按 agent 聚合
  const agentScores = new Map<string, {
    totalScore: number;
    count: number;
    maxScore: number;
    experienceIds: string[];
    tags: Set<string>;
  }>();

  for (const row of expResult.rows) {
    const expId = row.id as string;
    const agentId = row.publisher_agent_id as string;
    const expEmbedding = base64ToEmbedding(row.embedding as string);
    const expTags: string[] = JSON.parse(row.tags as string);

    const similarity = cosineSimilarity(queryEmbedding, expEmbedding);

    // 阈值过滤：相似度 < 0.4 的不算匹配
    if (similarity < 0.4) continue;

    // 标签加分：有共同标签 +0.1
    const tagBonus = tags.some(t => expTags.includes(t)) ? 0.1 : 0;
    const adjustedScore = Math.min(1, similarity + tagBonus);

    if (!agentScores.has(agentId)) {
      agentScores.set(agentId, {
        totalScore: 0,
        count: 0,
        maxScore: 0,
        experienceIds: [],
        tags: new Set(),
      });
    }

    const entry = agentScores.get(agentId)!;
    entry.totalScore += adjustedScore;
    entry.count++;
    entry.maxScore = Math.max(entry.maxScore, adjustedScore);
    entry.experienceIds.push(expId);
    for (const t of expTags) entry.tags.add(t);
  }

  // 排序：综合分数 = 最高单经验匹配分 * 0.7 + 经验数量 bonus * 0.3
  const matches: HelpMatchResult[] = [];
  for (const [agentId, data] of agentScores) {
    const countBonus = Math.min(data.count / 5, 1); // 最多 5 条经验给满分
    const finalScore = data.maxScore * 0.7 + countBonus * 0.3;

    if (finalScore >= 0.3) {
      matches.push({
        agent_id: agentId,
        match_score: Math.round(finalScore * 1000) / 1000,
        matched_experience_ids: data.experienceIds.slice(0, 5), // 最多记录 5 条
        matched_tags: [...data.tags].slice(0, 10),
      });
    }
  }

  // 按分数降序，取前 5 个 Agent
  matches.sort((a, b) => b.match_score - a.match_score);
  const topMatches = matches.slice(0, 5);

  // 存入 help_matches 表
  const now = new Date().toISOString();
  for (const match of topMatches) {
    await db.execute({
      sql: `INSERT INTO help_matches (id, request_id, agent_id, match_score, matched_experience_ids, matched_tags, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(request_id, agent_id) DO UPDATE SET
              match_score = excluded.match_score,
              matched_experience_ids = excluded.matched_experience_ids,
              matched_tags = excluded.matched_tags`,
      args: [
        randomUUID(),
        requestId,
        match.agent_id,
        match.match_score,
        JSON.stringify(match.matched_experience_ids),
        JSON.stringify(match.matched_tags),
        now,
      ],
    });
  }

  return topMatches;
}

// === 核心操作 ===

/**
 * 发起求助
 */
export async function createHelpRequest(
  requesterId: string,
  description: string,
  tags: string[],
  complexity: HelpComplexity = 'simple',
  diagnostics?: string,
): Promise<{ request: HelpRequest; matches: HelpMatchResult[]; credits_deducted: number }> {
  const db = getClient();

  // 每日限额检查
  const todayCount = await getHelpRequestCountToday(requesterId);
  if (todayCount >= DAILY_HELP_REQUEST_LIMIT) {
    throw new Error(`今日求助次数已达上限（${DAILY_HELP_REQUEST_LIMIT}次/天）`);
  }

  // 积分检查
  const cost = complexity === 'simple' ? Math.abs(CREDIT_RULES.help_simple) : Math.abs(CREDIT_RULES.help_complex);
  const hasCredits = await hasEnoughCredits(requesterId, cost);
  if (!hasCredits) {
    throw new Error(`积分不足（需要 ${cost} 积分）。发布经验或帮助他人可以赚取积分`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  // 生成 embedding 存储（用于匹配）
  let embeddingB64: string | null = null;
  try {
    const emb = await getEmbedding(description);
    if (emb) embeddingB64 = embeddingToBase64(emb);
  } catch (err) {
    console.error('求助 embedding 生成失败:', err);
  }

  await db.execute({
    sql: `INSERT INTO help_requests (id, requester_id, description, diagnostics, tags, complexity, status, embedding, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    args: [id, requesterId, description, diagnostics ?? null, JSON.stringify(tags), complexity, embeddingB64, now, now],
  });

  // 扣积分
  const deductAmount = complexity === 'simple' ? CREDIT_RULES.help_simple : CREDIT_RULES.help_complex;
  await adjustCredits(requesterId, deductAmount, `help_request_${complexity}`, id);

  // 匹配 Agent
  const matches = await matchAgentsForHelp(id, description, tags, requesterId);

  const request: HelpRequest = {
    id,
    requester_id: requesterId,
    description,
    diagnostics: diagnostics ?? null,
    tags,
    complexity,
    status: 'open',
    created_at: now,
    updated_at: now,
  };

  return { request, matches, credits_deducted: Math.abs(deductAmount) };
}

/**
 * 查看求助收件箱（匹配到我的求助）
 */
export async function getHelpInbox(
  agentId: string,
  includeResponded: boolean = false,
): Promise<Array<{
  request: HelpRequest;
  match_score: number;
  matched_tags: string[];
  my_response?: HelpResponse;
}>> {
  const db = getClient();

  // 查找匹配到我的且还未过期的求助
  const statusFilter = includeResponded
    ? "hr.status IN ('open', 'responded')"
    : "hr.status = 'open'";

  const result = await db.execute({
    sql: `
      SELECT hr.*, hm.match_score, hm.matched_tags
      FROM help_matches hm
      JOIN help_requests hr ON hr.id = hm.request_id
      WHERE hm.agent_id = ? AND ${statusFilter}
      ORDER BY hm.match_score DESC, hr.created_at DESC
      LIMIT 20
    `,
    args: [agentId],
  });

  const items: Array<{
    request: HelpRequest;
    match_score: number;
    matched_tags: string[];
    my_response?: HelpResponse;
  }> = [];

  for (const row of result.rows) {
    const request = rowToHelpRequest(row);

    // 检查我是否已经回复过
    const respResult = await db.execute({
      sql: 'SELECT * FROM help_responses WHERE request_id = ? AND responder_id = ?',
      args: [request.id, agentId],
    });

    const item: any = {
      request,
      match_score: row.match_score as number,
      matched_tags: JSON.parse(row.matched_tags as string),
    };

    if (respResult.rows.length > 0) {
      item.my_response = rowToHelpResponse(respResult.rows[0]);
    }

    items.push(item);
  }

  return items;
}

/**
 * 回复求助（写诊断报告）
 * 支持两种格式：
 * 1. 纯文本 content（后向兼容）
 * 2. 结构化 diagnostic_report（新格式，会同时存 content 和 report JSON）
 */
export async function respondToHelp(
  requestId: string,
  responderId: string,
  content: string,
  diagnosticReport?: DiagnosticReport,
): Promise<{ response: HelpResponse; credits_earned: number }> {
  const db = getClient();

  // 如果有结构化报告但 content 为空，自动生成文本版
  if (diagnosticReport && !content) {
    content = diagnosticReportToText(diagnosticReport);
  }

  // 检查求助存在且状态正确
  const reqResult = await db.execute({
    sql: "SELECT * FROM help_requests WHERE id = ? AND status IN ('open', 'responded')",
    args: [requestId],
  });
  if (reqResult.rows.length === 0) {
    throw new Error('求助不存在或已关闭');
  }

  const helpReq = rowToHelpRequest(reqResult.rows[0]);

  // 不能回复自己的求助
  if (helpReq.requester_id === responderId) {
    throw new Error('不能回复自己的求助');
  }

  // 检查是否被匹配到
  const matchResult = await db.execute({
    sql: 'SELECT 1 FROM help_matches WHERE request_id = ? AND agent_id = ?',
    args: [requestId, responderId],
  });
  if (matchResult.rows.length === 0) {
    throw new Error('你没有被匹配到这个求助');
  }

  // 每日响应限额
  const todayRespCount = await getHelpResponseCountToday(responderId);
  if (todayRespCount >= DAILY_HELP_RESPONSE_LIMIT) {
    throw new Error(`今日响应次数已达上限（${DAILY_HELP_RESPONSE_LIMIT}次/天）`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  const reportJson = diagnosticReport ? JSON.stringify(diagnosticReport) : null;

  await db.execute({
    sql: `INSERT INTO help_responses (id, request_id, responder_id, content, diagnostic_report, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(request_id, responder_id) DO UPDATE SET
            content = excluded.content,
            diagnostic_report = excluded.diagnostic_report,
            created_at = excluded.created_at`,
    args: [id, requestId, responderId, content, reportJson, now],
  });

  // 更新求助状态为 responded
  await db.execute({
    sql: "UPDATE help_requests SET status = 'responded', updated_at = ? WHERE id = ? AND status = 'open'",
    args: [now, requestId],
  });

  // 给响应者加积分
  const reward = helpReq.complexity === 'simple' ? CREDIT_RULES.respond_simple : CREDIT_RULES.respond_complex;
  await adjustCredits(responderId, reward, `help_respond_${helpReq.complexity}`, requestId);

  const response: HelpResponse = {
    id,
    request_id: requestId,
    responder_id: responderId,
    content,
    diagnostic_report: diagnosticReport ?? null,
    created_at: now,
  };

  return { response, credits_earned: reward };
}

/**
 * 标记求助已解决
 * 自动触发对话沉淀：把求助 + 回复整理为经验并发布
 */
export async function resolveHelp(
  requestId: string,
  requesterId: string,
  resolutionExperienceId?: string,
): Promise<{ request: HelpRequest; bonus_credits: number; distilled_experience_id?: string }> {
  const db = getClient();

  // 检查求助存在且是自己发起的
  const reqResult = await db.execute({
    sql: "SELECT * FROM help_requests WHERE id = ? AND requester_id = ?",
    args: [requestId, requesterId],
  });
  if (reqResult.rows.length === 0) {
    throw new Error('求助不存在或不属于你');
  }

  const helpReq = rowToHelpRequest(reqResult.rows[0]);
  if (helpReq.status === 'resolved') {
    throw new Error('求助已经标记为解决');
  }

  const now = new Date().toISOString();

  // 获取所有回复（用于沉淀）
  const respResult = await db.execute({
    sql: 'SELECT * FROM help_responses WHERE request_id = ? ORDER BY created_at ASC',
    args: [requestId],
  });
  const responses = respResult.rows.map(rowToHelpResponse);

  // 对话沉淀：自动将求助 + 回复整理为经验
  let distilledExpId: string | undefined;
  if (!resolutionExperienceId && responses.length > 0) {
    try {
      distilledExpId = await distillHelpToExperience(helpReq, responses, requesterId);
    } catch (err) {
      console.error('对话沉淀失败（不阻塞解决流程）:', err);
    }
  }

  const finalExpId = resolutionExperienceId ?? distilledExpId ?? null;

  // 更新状态
  await db.execute({
    sql: "UPDATE help_requests SET status = 'resolved', resolved_at = ?, updated_at = ?, resolution_experience_id = ? WHERE id = ?",
    args: [now, now, finalExpId, requestId],
  });

  // 给所有响应者额外 help_resolved 积分（他们的诊断报告帮助了求助者）
  let bonusTotal = 0;
  for (const resp of responses) {
    await adjustCredits(resp.responder_id, CREDIT_RULES.help_resolved, 'help_resolved', requestId);
    bonusTotal += CREDIT_RULES.help_resolved;
  }

  const updatedReq = { ...helpReq, status: 'resolved' as HelpStatus, resolved_at: now, resolution_experience_id: finalExpId };

  return { request: updatedReq, bonus_credits: bonusTotal, distilled_experience_id: distilledExpId };
}

// === 对话沉淀 ===

/**
 * 将已解决的求助对话蒸馏为一条经验并发布
 *
 * 组装逻辑（无需 LLM）：
 * - what: 求助描述的前 100 字
 * - context: 求助的 tags + diagnostics 摘要
 * - tried: 求助者描述的问题 + 尝试过的诊断
 * - outcome: 'succeeded'（已解决）
 * - outcome_detail: 响应者的修复建议摘要
 * - learned: 从诊断报告的 root_cause + fix_steps 提取，或从回复文本提取核心教训
 * - tags: 求助的 tags + 'distilled-from-help'
 *
 * 发布者为求助者（经验属于遇到问题的人）
 */
async function distillHelpToExperience(
  helpReq: HelpRequest,
  responses: HelpResponse[],
  requesterId: string,
): Promise<string> {
  // --- 组装 what ---
  const what = helpReq.description.slice(0, 100);

  // --- 组装 context ---
  const contextParts: string[] = [];
  if (helpReq.tags.length > 0) {
    contextParts.push(`领域: ${helpReq.tags.join(', ')}`);
  }
  if (helpReq.diagnostics) {
    // 取诊断信息的前 200 字作为上下文
    contextParts.push(`诊断摘要: ${helpReq.diagnostics.slice(0, 200)}`);
  }
  contextParts.push('来源: AgentXP 求助对话沉淀');
  const context = contextParts.join(' | ').slice(0, 300);

  // --- 组装 tried ---
  const triedParts: string[] = [`问题描述: ${helpReq.description}`];
  if (helpReq.diagnostics) {
    triedParts.push(`已收集的诊断信息: ${helpReq.diagnostics.slice(0, 200)}`);
  }
  const tried = triedParts.join('\n').slice(0, 500);

  // --- 从回复中提取 outcome_detail 和 learned ---
  let outcomeDetail = '';
  let learned = '';

  // 优先使用结构化诊断报告（信息密度更高）
  const structuredResponse = responses.find(r => r.diagnostic_report);
  if (structuredResponse?.diagnostic_report) {
    const report = structuredResponse.diagnostic_report;
    // outcome_detail: 修复步骤
    outcomeDetail = `修复方案: ${report.fix_steps.join('; ')}`.slice(0, 500);
    // learned: root_cause 是最核心的教训
    const learnedParts: string[] = [`根因: ${report.root_cause}`];
    if (report.notes) learnedParts.push(report.notes);
    learned = learnedParts.join('. ').slice(0, 500);
  } else {
    // 没有结构化报告，用回复文本
    const allContent = responses.map(r => r.content).join('\n---\n');
    outcomeDetail = `诊断回复: ${allContent}`.slice(0, 500);
    // 从回复文本提取教训（取前 500 字作为 learned）
    learned = `通过 AgentXP 求助获得诊断: ${allContent.slice(0, 450)}`;
    learned = learned.slice(0, 500);
  }

  // 确保 tried 和 learned 满足最低 20 字符门槛
  if (tried.length < 20) {
    // 不太可能发生（description 至少有内容），但防御性处理
    throw new Error('沉淀内容不足: tried 太短');
  }
  if (learned.length < 20) {
    throw new Error('沉淀内容不足: learned 太短');
  }

  // --- 组装标签 ---
  const tags = [...helpReq.tags];
  if (!tags.includes('distilled-from-help')) {
    tags.push('distilled-from-help');
  }
  // 限制标签数量
  const finalTags = tags.slice(0, 20);

  // --- 生成 embedding ---
  const text = experienceToText({
    what,
    context,
    tried,
    learned,
    tags: finalTags,
  });
  let embedding: Float32Array | null = null;
  try {
    embedding = await getEmbedding(text);
  } catch (err) {
    console.error('沉淀经验 embedding 生成失败:', err);
  }

  // --- 发布经验 ---
  const experience: Experience = {
    id: randomUUID(),
    version: 'serendip-experience/0.1',
    published_at: new Date().toISOString(),
    publisher: {
      agent_id: requesterId,
      platform: 'agentxp-distill',
    },
    core: {
      what,
      context,
      tried,
      outcome: 'succeeded',
      outcome_detail: outcomeDetail,
      learned,
    },
    tags: finalTags,
    agent_context: {
      platform: 'agentxp-distill',
      custom: {
        source: 'help_resolution',
        help_request_id: helpReq.id,
        responder_ids: responses.map(r => r.responder_id),
      },
    },
    trust: { operator_endorsed: false },
  };

  const expId = await insertExperience(experience, embedding);
  return expId;
}

/**
 * 获取求助详情（含所有回复）
 */
export async function getHelpRequestDetail(
  requestId: string,
): Promise<{ request: HelpRequest; responses: HelpResponse[]; matches: HelpMatchResult[] } | null> {
  const db = getClient();

  const reqResult = await db.execute({
    sql: 'SELECT * FROM help_requests WHERE id = ?',
    args: [requestId],
  });
  if (reqResult.rows.length === 0) return null;

  const request = rowToHelpRequest(reqResult.rows[0]);

  // 获取所有回复
  const respResult = await db.execute({
    sql: 'SELECT * FROM help_responses WHERE request_id = ? ORDER BY created_at ASC',
    args: [requestId],
  });
  const responses = respResult.rows.map(rowToHelpResponse);

  // 获取匹配
  const matchResult = await db.execute({
    sql: 'SELECT * FROM help_matches WHERE request_id = ? ORDER BY match_score DESC',
    args: [requestId],
  });
  const matches: HelpMatchResult[] = matchResult.rows.map(row => ({
    agent_id: row.agent_id as string,
    match_score: row.match_score as number,
    matched_experience_ids: JSON.parse(row.matched_experience_ids as string),
    matched_tags: JSON.parse(row.matched_tags as string),
  }));

  return { request, responses, matches };
}

/**
 * 获取 Agent 发起的求助列表
 */
export async function getMyHelpRequests(
  agentId: string,
  limit: number = 10,
): Promise<Array<{ request: HelpRequest; response_count: number }>> {
  const db = getClient();

  const result = await db.execute({
    sql: `
      SELECT hr.*, 
        (SELECT COUNT(*) FROM help_responses WHERE request_id = hr.id) as response_count
      FROM help_requests hr
      WHERE hr.requester_id = ?
      ORDER BY hr.created_at DESC
      LIMIT ?
    `,
    args: [agentId, limit],
  });

  return result.rows.map(row => ({
    request: rowToHelpRequest(row),
    response_count: row.response_count as number,
  }));
}

/**
 * 过期未解决的求助（由定时任务调用）
 */
export async function expireOldRequests(): Promise<number> {
  const db = getClient();
  const threshold = new Date(Date.now() - HELP_EXPIRE_DAYS * 86400000).toISOString();

  const result = await db.execute({
    sql: "UPDATE help_requests SET status = 'expired', updated_at = ? WHERE status IN ('open', 'responded') AND created_at < ?",
    args: [new Date().toISOString(), threshold],
  });

  return result.rowsAffected;
}

// === 工具函数 ===

function rowToHelpRequest(row: any): HelpRequest {
  return {
    id: row.id as string,
    requester_id: row.requester_id as string,
    description: row.description as string,
    diagnostics: row.diagnostics as string | null,
    tags: JSON.parse(row.tags as string),
    complexity: row.complexity as HelpComplexity,
    status: row.status as HelpStatus,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    resolved_at: row.resolved_at as string | null ?? undefined,
    resolution_experience_id: row.resolution_experience_id as string | null ?? undefined,
  };
}

function rowToHelpResponse(row: any): HelpResponse {
  let diagnosticReport: DiagnosticReport | null = null;
  if (row.diagnostic_report) {
    try {
      diagnosticReport = JSON.parse(row.diagnostic_report as string);
    } catch {
      // 解析失败就忽略
    }
  }
  return {
    id: row.id as string,
    request_id: row.request_id as string,
    responder_id: row.responder_id as string,
    content: row.content as string,
    diagnostic_report: diagnosticReport,
    created_at: row.created_at as string,
  };
}
