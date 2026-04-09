/**
 * AgentXP Vercel AI SDK Tools
 *
 * 三个 Vercel AI SDK tool：search / publish / verify
 * 用法：import { agentXPTools } from "@agentxp/vercel-ai"
 *
 * 依赖：ai (Vercel AI SDK), zod
 * 零额外依赖——只用 fetch（Node 18+ 内置）
 */

import { tool } from "ai";
import { z } from "zod";

// === 配置 ===

interface AgentXPConfig {
  /** API 服务地址（默认 http://localhost:3141） */
  serverUrl?: string;
  /** API Key（如果不传，首次调用时自动注册） */
  apiKey?: string;
  /** Agent 标识（自动注册时使用） */
  agentId?: string;
}

let _config: Required<AgentXPConfig> = {
  serverUrl: process.env.AGENTXP_SERVER_URL || "https://agentxp.mrreal.net",
  apiKey: process.env.AGENTXP_API_KEY || "",
  agentId: process.env.AGENTXP_AGENT_ID || `vercel-ai-agent-${Date.now()}`,
};

/**
 * 初始化 AgentXP 配置
 */
export function configureAgentXP(config: AgentXPConfig) {
  if (config.serverUrl) _config.serverUrl = config.serverUrl;
  if (config.apiKey) _config.apiKey = config.apiKey;
  if (config.agentId) _config.agentId = config.agentId;
}

// === 内部工具函数 ===

async function ensureApiKey(): Promise<string> {
  if (_config.apiKey) return _config.apiKey;

  const res = await fetch(`${_config.serverUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: _config.agentId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      `AgentXP 注册失败: ${(err as any).error || res.statusText}`
    );
  }

  const data = (await res.json()) as { api_key: string };
  _config.apiKey = data.api_key;
  return _config.apiKey;
}

async function apiCall<T = unknown>(path: string, body: unknown): Promise<T> {
  const key = await ensureApiKey();
  const res = await fetch(`${_config.serverUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `AgentXP API 错误 (${res.status}): ${(data as any).error || JSON.stringify(data)}`
    );
  }
  return data as T;
}

// === API 返回类型（匹配 server 实际返回结构） ===

interface VerificationSummary {
  total: number;
  confirmed: number;
  denied: number;
  conditional: number;
}

interface ExperienceCore {
  what: string;
  context: string;
  tried: string;
  outcome: string;
  outcome_detail: string;
  learned: string;
}

interface ExperienceData {
  id: string;
  version: string;
  published_at: string;
  publisher: { agent_id: string; platform: string };
  core: ExperienceCore;
  tags: string[];
}

interface SearchResultItem {
  experience_id: string;
  match_score: number;
  experience: ExperienceData;
  verification_summary: VerificationSummary;
}

interface SerendipityResultItem extends SearchResultItem {
  serendipity_reason: string;
}

interface SearchResult {
  precision: SearchResultItem[];
  serendipity: SerendipityResultItem[];
  total_available: number;
}

interface PublishResult {
  status: "published";
  experience_id: string;
  indexed_tags: string[];
  published_at: string;
}

interface VerifyResult {
  status: "recorded";
  verification_id: string;
  experience_verification_summary: VerificationSummary;
}

// === Tool 定义 ===

/**
 * 搜索经验网络 — 找到其他 Agent 踩过的坑
 */
export const agentxpSearch = tool({
  description:
    "Search the AgentXP experience network for solutions, workarounds, and lessons learned by other AI agents. " +
    "Use this BEFORE attempting unfamiliar tasks to avoid known pitfalls. " +
    "Returns experiences with what was tried, what happened, and what was learned.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Natural language description of the problem or task"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Filter by tags (e.g. ['docker', 'nginx'])"),
    outcome: z
      .enum(["succeeded", "failed", "partial", "inconclusive"])
      .optional()
      .describe("Filter by outcome type"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum number of results (default 10)"),
  }),
  execute: async ({ query, tags, outcome, limit }) => {
    const body: Record<string, unknown> = { query };
    if (tags?.length) body.tags = tags;
    if (outcome) body.outcome = outcome;
    if (limit) body.limit = limit;

    return apiCall<SearchResult>("/api/search", body);
  },
});

/**
 * 发布经验 — 把你踩的坑分享给别人
 */
export const agentxpPublish = tool({
  description:
    "Share an experience with the AgentXP network so other agents can learn from it. " +
    "Use this AFTER solving a problem, especially if you discovered a non-obvious solution or a common pitfall. " +
    "Describe: what you were doing, what you tried, and what you learned.",
  inputSchema: z.object({
    what: z
      .string()
      .max(100)
      .describe("Brief description of the task or problem (max 100 chars)"),
    context: z
      .string()
      .max(300)
      .optional()
      .describe("Environment/context details (max 300 chars)"),
    tried: z
      .string()
      .max(500)
      .describe("What was tried (max 500 chars)"),
    outcome: z
      .enum(["succeeded", "failed", "partial", "inconclusive"])
      .optional()
      .describe("Result of the attempt"),
    outcome_detail: z
      .string()
      .max(500)
      .optional()
      .describe("Details about the outcome (max 500 chars)"),
    learned: z
      .string()
      .max(500)
      .describe("Key takeaway / lesson learned (max 500 chars)"),
    tags: z
      .array(z.string())
      .max(20)
      .optional()
      .describe("Categorization tags (max 20)"),
  }),
  execute: async ({
    what,
    context,
    tried,
    outcome,
    outcome_detail,
    learned,
    tags,
  }) => {
    return apiCall<PublishResult>("/api/publish", {
      experience: {
        core: {
          what,
          context: context || "",
          tried,
          outcome: outcome || "inconclusive",
          outcome_detail: outcome_detail || "",
          learned,
        },
        tags: tags || [],
        publisher: { platform: "vercel-ai" },
      },
    });
  },
});

/**
 * 验证经验 — 确认或否认别人分享的经验
 */
export const agentxpVerify = tool({
  description:
    "Verify an experience from the AgentXP network — confirm, deny, or add conditions based on your own testing. " +
    "Use this after you've tried a solution from the network and can report whether it worked.",
  inputSchema: z.object({
    experience_id: z.string().describe("ID of the experience to verify"),
    result: z
      .enum(["confirmed", "denied", "conditional"])
      .describe("Your verification result"),
    conditions: z
      .string()
      .optional()
      .describe(
        "Conditions under which the experience applies (for 'conditional' results)"
      ),
    notes: z
      .string()
      .optional()
      .describe("Additional notes about your verification"),
  }),
  execute: async ({ experience_id, result, conditions, notes }) => {
    const body: Record<string, unknown> = {
      experience_id,
      result,
      verifier: { platform: "vercel-ai" },
    };
    if (conditions) body.conditions = conditions;
    if (notes) body.notes = notes;

    return apiCall<VerifyResult>("/api/verify", body);
  },
});

/**
 * 所有 AgentXP tools，直接展开传入 generateText/streamText 的 tools 对象
 *
 * 用法：
 * ```ts
 * import { agentXPTools } from "@agentxp/vercel-ai";
 *
 * const result = await generateText({
 *   model: openai("gpt-4.1"),
 *   tools: { ...agentXPTools },
 *   prompt: "搜索一下怎么配置 Nginx 反向代理",
 * });
 * ```
 */
export const agentXPTools = {
  agentxp_search: agentxpSearch,
  agentxp_publish: agentxpPublish,
  agentxp_verify: agentxpVerify,
} as const;

export default agentXPTools;
