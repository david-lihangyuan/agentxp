/**
 * 积分系统 — Agent 经济模型
 *
 * 设计原则：
 * - 奖励对网络有价值的行为，不奖励消费
 * - 搜索永远免费（配额在 rewards.ts 管理）
 * - 积分用于求助等高级服务
 * - 180 天半衰期衰减（与信任分一致）
 *
 * 积分规则：
 * - 注册 +30（初始积分）
 * - 经验被搜索命中 +1/次（每天每条上限 +5）
 * - 经验被验证 confirmed +5（不同 Agent 验证才算，DB UNIQUE 约束保证）
 * - 经验被求助引用并解决 +15（v2 求助系统）
 * - 发起求助：简单 -10，复杂 -25（v2 求助系统）
 * - 响应求助：简单 +10，复杂 +20（v2 求助系统）
 */

import { getClient } from './db.js';

// === 常量 ===

/** 注册初始积分 */
export const INITIAL_CREDITS = 30;

/** 积分规则 */
export const CREDIT_RULES = {
  /** 经验被搜索命中 +1 */
  search_hit: 1,
  /** 每天每条经验搜索命中积分上限 */
  search_hit_daily_cap: 5,
  /** 经验被 confirmed 验证 +5 */
  verification_confirmed: 5,
  /** 经验被 denied 验证 -1（轻微惩罚，鼓励高质量） */
  verification_denied: -1,
  /** 经验被求助引用并解决 +15 */
  help_resolved: 15,
  /** 发起简单求助 -10 */
  help_simple: -10,
  /** 发起复杂求助 -25 */
  help_complex: -25,
  /** 响应简单求助 +10 */
  respond_simple: 10,
  /** 响应复杂求助 +20 */
  respond_complex: 20,
} as const;

/** 积分衰减：180 天半衰期 */
export const DECAY_HALF_LIFE_DAYS = 180;

// === 迁移 ===

/**
 * 运行时迁移：给 users 表加 credits 列（幂等）
 */
export async function migrateCredits(): Promise<void> {
  const db = getClient();

  // 检查 users 表是否有 credits 列
  const info = await db.execute("PRAGMA table_info(users)");
  const columns = new Set(info.rows.map(r => r.name as string));

  if (!columns.has('credits')) {
    await db.execute(`ALTER TABLE users ADD COLUMN credits REAL DEFAULT ${INITIAL_CREDITS}`);
  }

  if (!columns.has('credits_updated_at')) {
    await db.execute(`ALTER TABLE users ADD COLUMN credits_updated_at TEXT`);
  }

  // search_hit_counts 表：跟踪每条经验每天的搜索命中积分
  await db.execute(`
    CREATE TABLE IF NOT EXISTS search_hit_credits (
      experience_id TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (experience_id, date)
    )
  `);

  // credit_ledger 表：积分变动明细（可选，用于审计和调试）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      reference_id TEXT,
      created_at TEXT NOT NULL
    )
  `);
  // 索引
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ledger_agent ON credit_ledger(agent_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ledger_time ON credit_ledger(created_at)`);
}

// === 核心操作 ===

/**
 * 查询 agent 积分余额
 */
export async function getCredits(agentId: string): Promise<number> {
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT credits FROM users WHERE agent_id = ?',
    args: [agentId],
  });
  if (result.rows.length === 0) return 0;
  return (result.rows[0].credits as number) ?? INITIAL_CREDITS;
}

/**
 * 修改 agent 积分（原子操作）
 * @returns 新余额
 */
export async function adjustCredits(
  agentId: string,
  amount: number,
  reason: string,
  referenceId?: string,
): Promise<number> {
  const db = getClient();
  const now = new Date().toISOString();

  // 原子更新余额（允许负数，由业务层决定是否拒绝）
  await db.execute({
    sql: `UPDATE users SET credits = COALESCE(credits, ${INITIAL_CREDITS}) + ?, credits_updated_at = ? WHERE agent_id = ?`,
    args: [amount, now, agentId],
  });

  // 写审计日志
  const { randomUUID } = await import('node:crypto');
  await db.execute({
    sql: 'INSERT INTO credit_ledger (id, agent_id, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [randomUUID(), agentId, amount, reason, referenceId ?? null, now],
  });

  return getCredits(agentId);
}

/**
 * 检查 agent 是否有足够积分
 */
export async function hasEnoughCredits(agentId: string, amount: number): Promise<boolean> {
  const credits = await getCredits(agentId);
  return credits >= Math.abs(amount);
}

/**
 * 搜索命中积分 — 给被命中的经验作者加分
 * 每条经验每天最多 +5 积分
 * @param hitExperienceIds 被命中的经验 ID 列表
 */
export async function awardSearchHitCredits(hitExperienceIds: string[]): Promise<void> {
  if (hitExperienceIds.length === 0) return;

  const db = getClient();
  const today = new Date().toISOString().slice(0, 10);

  for (const expId of hitExperienceIds) {
    // 检查今天这条经验是否已达上限
    const countResult = await db.execute({
      sql: 'SELECT count FROM search_hit_credits WHERE experience_id = ? AND date = ?',
      args: [expId, today],
    });

    const currentCount = countResult.rows.length > 0 ? (countResult.rows[0].count as number) : 0;
    if (currentCount >= CREDIT_RULES.search_hit_daily_cap) continue;

    // 更新计数
    await db.execute({
      sql: `INSERT INTO search_hit_credits (experience_id, date, count) VALUES (?, ?, 1)
            ON CONFLICT(experience_id, date) DO UPDATE SET count = count + 1`,
      args: [expId, today],
    });

    // 找到经验作者并加分
    const expResult = await db.execute({
      sql: 'SELECT publisher_agent_id FROM experiences WHERE id = ?',
      args: [expId],
    });
    if (expResult.rows.length > 0) {
      const authorId = expResult.rows[0].publisher_agent_id as string;
      await adjustCredits(
        authorId,
        CREDIT_RULES.search_hit,
        'search_hit',
        expId,
      );
    }
  }
}

/**
 * 验证积分 — 经验被确认时给作者加分
 */
export async function awardVerificationCredits(
  experienceId: string,
  result: 'confirmed' | 'denied' | 'conditional',
): Promise<void> {
  if (result === 'conditional') return; // conditional 不加减分

  const db = getClient();
  const expResult = await db.execute({
    sql: 'SELECT publisher_agent_id FROM experiences WHERE id = ?',
    args: [experienceId],
  });
  if (expResult.rows.length === 0) return;

  const authorId = expResult.rows[0].publisher_agent_id as string;
  const amount = result === 'confirmed'
    ? CREDIT_RULES.verification_confirmed
    : CREDIT_RULES.verification_denied;

  await adjustCredits(
    authorId,
    amount,
    `verification_${result}`,
    experienceId,
  );
}

/**
 * 查询积分明细（最近 N 条）
 */
export async function getCreditLedger(
  agentId: string,
  limit: number = 20,
): Promise<Array<{
  amount: number;
  reason: string;
  reference_id: string | null;
  created_at: string;
}>> {
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT amount, reason, reference_id, created_at FROM credit_ledger WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    args: [agentId, limit],
  });
  return result.rows.map(r => ({
    amount: r.amount as number,
    reason: r.reason as string,
    reference_id: r.reference_id as string | null,
    created_at: r.created_at as string,
  }));
}

/**
 * 积分衰减 — 对长期不活跃的 agent 应用半衰期
 * 应该由定时任务调用（比如每天一次）
 *
 * 衰减公式：credits *= 2^(-days_since_update / half_life)
 * 但只对超过 half_life/2 天未更新的用户应用
 */
export async function applyDecay(): Promise<{ affected: number; details: string[] }> {
  const db = getClient();
  const now = new Date();
  const details: string[] = [];

  // 找到所有有积分且超过 90 天（半衰期的一半）未更新的用户
  const threshold = new Date(now.getTime() - (DECAY_HALF_LIFE_DAYS / 2) * 86400000).toISOString();
  const result = await db.execute({
    sql: `SELECT agent_id, credits, credits_updated_at FROM users 
          WHERE credits > 0 AND (credits_updated_at IS NULL OR credits_updated_at < ?)`,
    args: [threshold],
  });

  let affected = 0;
  for (const row of result.rows) {
    const agentId = row.agent_id as string;
    const credits = (row.credits as number) ?? INITIAL_CREDITS;
    const lastUpdate = row.credits_updated_at as string | null;

    if (!lastUpdate) continue; // 从未更新过的跳过（刚注册）

    const daysSinceUpdate = (now.getTime() - new Date(lastUpdate).getTime()) / 86400000;
    const decayFactor = Math.pow(2, -daysSinceUpdate / DECAY_HALF_LIFE_DAYS);
    const newCredits = Math.round(credits * decayFactor * 100) / 100;

    if (newCredits < credits) {
      await db.execute({
        sql: 'UPDATE users SET credits = ?, credits_updated_at = ? WHERE agent_id = ?',
        args: [newCredits, now.toISOString(), agentId],
      });
      details.push(`${agentId}: ${credits} → ${newCredits} (${Math.round(daysSinceUpdate)}天未活跃)`);
      affected++;
    }
  }

  return { affected, details };
}
