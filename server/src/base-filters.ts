/**
 * Serendip 协议 — 通用基础过滤器
 *
 * 所有场景共享的过滤逻辑。避免每个场景独立实现导致的遗漏和偏差。
 *
 * 使用方式：各场景 search.ts 在场景特定过滤之后调用 applyBaseFilters()。
 *
 * v2：支持 async getVerificationSummary（libSQL 改造后 db 操作全部 async）
 */

// === 通用接口 ===

/** 任何可被过滤的意图/经验必须实现的最小接口 */
export interface Filterable {
  id: string;
  published_at: string;        // ISO 8601
  ttl_days?: number | null;    // 自身声明的有效期
  tags: string[];              // 标签列表
}

/** 通用过滤参数（各场景可在此基础上扩展） */
export interface BaseFilters {
  max_age_days?: number;       // 最大年龄（天）
  min_verifications?: number;  // 最少确认验证次数
}

/** 验证摘要查询函数（支持同步或异步） */
export type GetVerificationSummary = (id: string) => { confirmed: number } | Promise<{ confirmed: number }>;

// === 核心过滤函数 ===

/**
 * 应用所有通用基础过滤器
 *
 * @param item      待过滤项（经验或意图）
 * @param filters   过滤条件
 * @param tags      标签过滤（OR 语义：命中任一即通过）
 * @param getVerSum 验证摘要查询函数（仅在 min_verifications > 0 时调用）
 * @returns Promise<boolean> — true = 保留，false = 过滤掉
 */
export async function applyBaseFilters(
  item: Filterable,
  filters?: BaseFilters,
  tags?: string[],
  getVerSum?: GetVerificationSummary,
): Promise<boolean> {
  const now = Date.now();
  const publishedMs = new Date(item.published_at).getTime();
  const age = (now - publishedMs) / 86400000;

  // 1. max_age_days：超过指定天数的过滤掉
  if (filters?.max_age_days && age > filters.max_age_days) {
    return false;
  }

  // 2. ttl_days：自身声明的有效期，过期则过滤
  if (item.ttl_days != null && item.ttl_days > 0 && age > item.ttl_days) {
    return false;
  }

  // 3. min_verifications：至少 N 次确认验证
  if (filters?.min_verifications && filters.min_verifications > 0 && getVerSum) {
    const verSum = await getVerSum(item.id);
    if (verSum.confirmed < filters.min_verifications) {
      return false;
    }
  }

  // 4. tags：OR 语义（命中任一标签即通过）
  if (tags && tags.length > 0) {
    const itemTags = new Set(item.tags);
    if (!tags.some(t => itemTags.has(t))) {
      return false;
    }
  }

  return true;
}

// === 辅助：年龄计算（避免各场景重复计算） ===

export function ageDays(published_at: string): number {
  return (Date.now() - new Date(published_at).getTime()) / 86400000;
}

// === 辅助：时间衰减 ===

export function timeDecay(published_at: string, halfLifeDays: number): number {
  return Math.pow(0.5, ageDays(published_at) / halfLifeDays);
}
