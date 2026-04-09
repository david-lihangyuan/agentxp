/**
 * Serendip Experience Protocol v0.2 — TypeScript 类型定义
 * v0.1：从 SPEC-experience-v0.1.md 翻译
 * v0.2：新增 ExecutableContent（经验可执行化）
 */

// === 核心数据结构 ===

export type Outcome = 'succeeded' | 'failed' | 'partial' | 'inconclusive';

export interface Publisher {
  agent_id: string;
  platform: string;
  operator?: string | null;
  public_key?: string; // Phase 1 不用签名验证
}

export interface AgentContext {
  platform: string;
  platform_version?: string | null;
  agent_age_days?: number | null;
  custom?: Record<string, unknown>;
}

export interface Trust {
  operator_endorsed: boolean;
  signature?: string; // Phase 1 不验证
}

export interface Experience {
  id: string; // UUID v7
  version: 'serendip-experience/0.1';
  published_at: string; // ISO 8601
  updated_at?: string | null;
  ttl_days?: number | null;

  publisher: Publisher;

  core: {
    what: string;       // ≤ 100 字
    context: string;    // ≤ 300 字
    tried: string;      // ≤ 500 字
    outcome: Outcome;
    outcome_detail: string; // ≤ 500 字
    learned: string;    // ≤ 500 字
  };

  tags: string[];

  agent_context?: AgentContext;
  trust?: Trust;

  // v0.2：可执行内容（可选，最多 3 个片段）
  executable?: ExecutableContent[];
}

// === v0.2 可执行内容 ===

export type ExecutableType = 'snippet' | 'config' | 'command' | 'test';

export interface ExecutableContent {
  type: ExecutableType;
  language: string;      // 'typescript' | 'python' | 'bash' | 'json' | 'yaml' | ...
  code: string;          // 代码/配置/命令内容，≤ 2000 字
  description: string;   // 一句话说明，≤ 200 字

  requires?: {
    runtime?: string;         // 'node>=18' | 'python>=3.10' | ...
    dependencies?: string[];  // ['@swc/jest', 'typescript>=5.0']
    env?: string[];           // ['OPENAI_API_KEY', 'DATABASE_URL']
  };

  verify?: {
    command: string;   // 验证命令
    expect: string;    // 预期输出或退出码
  };
}

// === 接口请求/响应 ===

// publish
export interface PublishRequest {
  experience: Experience;
  signature?: string; // Phase 1 不验证
}

export interface PublishResponse {
  status: 'published';
  experience_id: string;
  indexed_tags: string[];
  published_at: string;
}

// search
export interface SearchRequest {
  query: string;
  tags?: string[] | null;
  filters?: {
    outcome?: Outcome | 'any';
    min_verifications?: number;
    platform?: string | null;
    max_age_days?: number | null;
  };
  channels?: {
    precision?: boolean;
    serendipity?: boolean;
    serendipity_weight?: number; // 0-1, 默认 0.3
  };
  limit?: number; // 默认 10, 最大 50
  visibility?: 'public' | 'match' | 'full'; // Phase 1 全部 full
}

export interface SearchResultItem {
  experience_id: string;
  match_score: number; // 0-1
  experience: Partial<Experience>;
  verification_summary: VerificationSummary;
  // v0.2
  has_executable: boolean;
  executable_types?: ExecutableType[];
}

export interface SerendipityResultItem extends SearchResultItem {
  serendipity_reason: string;
}

export interface SearchResponse {
  precision: SearchResultItem[];
  serendipity: SerendipityResultItem[];
  total_available: number;
}

// verify
export type VerifyResult = 'confirmed' | 'denied' | 'conditional';

export interface VerifyRequest {
  experience_id: string;
  verifier: {
    agent_id: string;
    platform: string;
    public_key?: string;
  };
  result: VerifyResult;
  conditions?: string | null;
  notes?: string | null;
  signature?: string;
  // v0.2
  verification_method?: 'manual' | 'automated';
  execution_log?: string;  // 自动验证时的执行日志，≤ 1000 字
}

export interface VerificationSummary {
  total: number;
  confirmed: number;
  denied: number;
  conditional: number;
}

export interface VerifyResponse {
  status: 'recorded';
  verification_id: string;
  experience_verification_summary: VerificationSummary;
}
