/**
 * 奖励机制 — Agent 贡献者等级 + 搜索配额
 *
 * 设计原则：
 * - 不加新表，用现有数据动态计算
 * - 奖励贡献行为（发布、被验证），不奖励消费行为
 * - 搜索配额 = 基础配额 + 贡献加成
 * - 贡献者等级基于被验证的经验数 + 确认率
 */

import { getClient, getSearchCountTodayFromDB, type AgentSearchStats, getAgentSearchStats } from './db.js';

// === 贡献者等级 ===

export type ContributorTier = 'newcomer' | 'contributor' | 'verified' | 'trusted';

export interface ContributorProfile {
  agent_id: string;
  tier: ContributorTier;
  tier_label: string;

  // 贡献统计
  stats: {
    /** 发布的经验总数 */
    experiences_published: number;
    /** 被验证的经验数（至少 1 次验证） */
    experiences_verified: number;
    /** 被确认的经验数 */
    experiences_confirmed: number;
    /** 被否认的经验数 */
    experiences_denied: number;
    /** 给别人做的验证数 */
    verifications_given: number;
    /** 确认率（confirmed / (confirmed + denied)） */
    confirmation_rate: number;
  };

  // 搜索配额
  quota: {
    /** 每日搜索配额上限（-1 = 无限） */
    daily_limit: number;
    /** 今日已用 */
    used_today: number;
    /** 剩余可用（-1 = 无限） */
    remaining: number;
  };

  // 搜索统计
  search_stats: AgentSearchStats;

  // 升级提示
  next_tier: {
    tier: ContributorTier | null;
    label: string | null;
    /** 差多少条被验证经验 */
    needs_verified: number;
    /** 差多少确认率 */
    needs_confirmation_rate: number;
  };
}

// === 等级规则 ===

const TIER_RULES = {
  trusted: {
    min_verified: 10,
    min_confirmation_rate: 0.80,
    label: '🏆 可信贡献者',
  },
  verified: {
    min_verified: 5,
    min_confirmation_rate: 0,
    label: '✅ 认证贡献者',
  },
  contributor: {
    min_experiences: 1,
    label: '🌱 贡献者',
  },
  newcomer: {
    label: '👋 新成员',
  },
} as const;

// === 配额规则 ===

const QUOTA_RULES = {
  /** 基础每日搜索配额 */
  base_daily: 50,
  /** 每发布 1 条经验 +N 次/天 */
  per_experience: 10,
  /** Verified Contributor 额外配额 */
  verified_bonus: 50,
  /** Trusted Contributor 无限制 */
  trusted_unlimited: true,
  /** 配额硬上限（非 trusted） */
  max_daily: 500,
} as const;

// === 核心函数 ===

/**
 * 计算 agent 的贡献者等级
 */
function calculateTier(
  experiencesPublished: number,
  experiencesVerified: number,
  confirmationRate: number,
): ContributorTier {
  if (
    experiencesVerified >= TIER_RULES.trusted.min_verified &&
    confirmationRate >= TIER_RULES.trusted.min_confirmation_rate
  ) {
    return 'trusted';
  }

  if (experiencesVerified >= TIER_RULES.verified.min_verified) {
    return 'verified';
  }

  if (experiencesPublished >= (TIER_RULES.contributor.min_experiences ?? 1)) {
    return 'contributor';
  }

  return 'newcomer';
}

/**
 * 计算每日搜索配额
 */
function calculateDailyQuota(tier: ContributorTier, experiencesPublished: number): number {
  if (tier === 'trusted') return -1; // 无限

  let quota = QUOTA_RULES.base_daily;
  quota += experiencesPublished * QUOTA_RULES.per_experience;

  if (tier === 'verified') {
    quota += QUOTA_RULES.verified_bonus;
  }

  return Math.min(quota, QUOTA_RULES.max_daily);
}

/**
 * 计算升级到下一等级需要什么
 */
function calculateNextTier(
  currentTier: ContributorTier,
  experiencesVerified: number,
  confirmationRate: number,
): ContributorProfile['next_tier'] {
  switch (currentTier) {
    case 'trusted':
      return { tier: null, label: null, needs_verified: 0, needs_confirmation_rate: 0 };

    case 'verified':
      return {
        tier: 'trusted',
        label: TIER_RULES.trusted.label,
        needs_verified: Math.max(0, TIER_RULES.trusted.min_verified - experiencesVerified),
        needs_confirmation_rate: Math.max(0, TIER_RULES.trusted.min_confirmation_rate - confirmationRate),
      };

    case 'contributor':
      return {
        tier: 'verified',
        label: TIER_RULES.verified.label,
        needs_verified: Math.max(0, TIER_RULES.verified.min_verified - experiencesVerified),
        needs_confirmation_rate: 0,
      };

    case 'newcomer':
      return {
        tier: 'contributor',
        label: TIER_RULES.contributor.label,
        needs_verified: 0, // 只需发布 1 条经验
        needs_confirmation_rate: 0,
      };
  }
}

/**
 * 搜索计数 — 双层：内存缓存 + DB 持久化
 * 
 * 写入路径：recordSearch() 更新内存 + 由 index.ts 的搜索路由写 search_logs 表
 * 读取路径：优先读内存（快），miss 时查 DB
 */
const dailySearchCounts = new Map<string, { date: string; count: number }>();

function getTodayString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** 内存侧递增（搜索路由调用）*/
export function recordSearch(agentId: string): void {
  const today = getTodayString();
  const entry = dailySearchCounts.get(agentId);
  if (!entry || entry.date !== today) {
    dailySearchCounts.set(agentId, { date: today, count: 1 });
  } else {
    entry.count++;
  }
}

/** 读取今日搜索次数（内存优先，miss 查 DB） */
export async function getSearchCountToday(agentId: string): Promise<number> {
  const today = getTodayString();
  const entry = dailySearchCounts.get(agentId);
  if (entry && entry.date === today) return entry.count;
  // 内存没有（可能服务重启过），从 DB 恢复
  const dbCount = await getSearchCountTodayFromDB(agentId);
  dailySearchCounts.set(agentId, { date: today, count: dbCount });
  return dbCount;
}

/** 同步版本（仅读内存，用于不需要 await 的场景） */
export function getSearchCountTodaySync(agentId: string): number {
  const today = getTodayString();
  const entry = dailySearchCounts.get(agentId);
  if (entry && entry.date === today) return entry.count;
  return 0; // 内存 miss 时返回 0，不查 DB
}

/**
 * 获取完整的 agent 档案
 */
export async function getAgentProfile(agentId: string): Promise<ContributorProfile> {
  const db = getClient();

  // 并行查询所有需要的数据
  const [
    expCountResult,
    verifiedCountResult,
    confirmedCountResult,
    deniedCountResult,
    verificationsGivenResult,
  ] = await Promise.all([
    // 发布的经验总数
    db.execute({
      sql: 'SELECT COUNT(*) as c FROM experiences WHERE publisher_agent_id = ?',
      args: [agentId],
    }),
    // 被验证过的经验数（至少 1 次验证）
    db.execute({
      sql: `SELECT COUNT(DISTINCT e.id) as c 
            FROM experiences e 
            JOIN verifications v ON v.experience_id = e.id 
            WHERE e.publisher_agent_id = ?`,
      args: [agentId],
    }),
    // 被确认的经验数
    db.execute({
      sql: `SELECT COUNT(DISTINCT e.id) as c 
            FROM experiences e 
            JOIN verifications v ON v.experience_id = e.id 
            WHERE e.publisher_agent_id = ? AND v.result = 'confirmed'`,
      args: [agentId],
    }),
    // 被否认的经验数
    db.execute({
      sql: `SELECT COUNT(DISTINCT e.id) as c 
            FROM experiences e 
            JOIN verifications v ON v.experience_id = e.id 
            WHERE e.publisher_agent_id = ? AND v.result = 'denied'`,
      args: [agentId],
    }),
    // 给别人做的验证数
    db.execute({
      sql: 'SELECT COUNT(*) as c FROM verifications WHERE verifier_agent_id = ?',
      args: [agentId],
    }),
  ]);

  const experiencesPublished = expCountResult.rows[0].c as number;
  const experiencesVerified = verifiedCountResult.rows[0].c as number;
  const experiencesConfirmed = confirmedCountResult.rows[0].c as number;
  const experiencesDenied = deniedCountResult.rows[0].c as number;
  const verificationsGiven = verificationsGivenResult.rows[0].c as number;

  // 确认率
  const totalJudged = experiencesConfirmed + experiencesDenied;
  const confirmationRate = totalJudged > 0
    ? Math.round((experiencesConfirmed / totalJudged) * 100) / 100
    : 0;

  // 等级
  const tier = calculateTier(experiencesPublished, experiencesVerified, confirmationRate);
  const tierLabel = TIER_RULES[tier].label;

  // 配额
  const dailyLimit = calculateDailyQuota(tier, experiencesPublished);
  const usedToday = await getSearchCountToday(agentId);
  const remaining = dailyLimit === -1 ? -1 : Math.max(0, dailyLimit - usedToday);

  // 升级提示
  const nextTier = calculateNextTier(tier, experiencesVerified, confirmationRate);

  // 搜索统计
  const searchStats = await getAgentSearchStats(agentId);

  return {
    agent_id: agentId,
    tier,
    tier_label: tierLabel,
    stats: {
      experiences_published: experiencesPublished,
      experiences_verified: experiencesVerified,
      experiences_confirmed: experiencesConfirmed,
      experiences_denied: experiencesDenied,
      verifications_given: verificationsGiven,
      confirmation_rate: confirmationRate,
    },
    quota: {
      daily_limit: dailyLimit,
      used_today: usedToday,
      remaining,
    },
    search_stats: searchStats,
    next_tier: nextTier,
  };
}

/**
 * 检查 agent 是否还有搜索配额
 * 返回 true = 可以搜索，false = 超配额
 */
export async function checkSearchQuota(agentId: string): Promise<{
  allowed: boolean;
  profile: ContributorProfile;
}> {
  const profile = await getAgentProfile(agentId);

  // 无限配额
  if (profile.quota.daily_limit === -1) {
    return { allowed: true, profile };
  }

  // 检查配额
  const allowed = profile.quota.remaining > 0;
  return { allowed, profile };
}
