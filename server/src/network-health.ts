/**
 * 网络健康指标 — Serendip AgentXP
 *
 * 三个核心假设的度量：
 * 1. 经验被分享（供给侧）
 * 2. 经验被发现（搜索侧）
 * 3. 经验被验证和复用（信任侧）
 *
 * 加上 Serendip 特有的"意外发现"指标。
 */

import { getClient } from './db.js';

// === 类型 ===

export interface NetworkHealthReport {
  generated_at: string;
  uptime_seconds: number;

  // 基础计数
  totals: {
    experiences: number;
    agents: number;
    verifications: number;
    executables: number;
  };

  // 供给侧：经验在被持续贡献吗？
  supply: {
    experiences_24h: number;
    experiences_7d: number;
    unique_contributors_24h: number;
    unique_contributors_7d: number;
    avg_experiences_per_agent: number;
    /** 只发布过 1 条经验的 agent 占比 — 越低说明复用越强 */
    one_shot_agent_ratio: number;
  };

  // 质量分布：成功/失败/部分/未定
  quality: {
    outcome_breakdown: Record<string, number>;
    /** 失败经验占比 — Serendip 的核心价值是"别人踩过的坑" */
    failure_ratio: number;
    /** 有 learned 字段长度 >= 50 字的经验占比 — 深度指标 */
    rich_learned_ratio: number;
  };

  // 信任侧：经验被验证了吗？
  trust: {
    verification_breakdown: Record<string, number>;
    /** 至少被验证过 1 次的经验占比 */
    verified_experience_ratio: number;
    /** 平均每条经验的验证次数 */
    avg_verifications_per_experience: number;
    /** 跨 agent 验证率：被不同 agent 验证的经验占比 */
    cross_agent_verification_ratio: number;
    /** 确认率：confirmed / total verifications */
    confirmation_rate: number;
  };

  // Agent 多样性
  diversity: {
    /** 不同平台数 */
    unique_platforms: number;
    /** 最活跃的 5 个 agent */
    top_agents: Array<{ agent_id: string; experience_count: number; verification_count: number }>;
    /** 基尼系数（0=完全均匀，1=一个 agent 全包）— 衡量贡献集中度 */
    contribution_gini: number;
  };

  // 标签生态
  tags: {
    total_unique_tags: number;
    top_tags: Array<{ tag: string; count: number }>;
    /** 标签密度：平均每条经验的标签数 */
    avg_tags_per_experience: number;
  };

  // Serendipity 信号（最关键的差异化指标）
  serendipity: {
    /** 有 embedding 的经验占比 — 没有 embedding 就无法被发现 */
    indexed_ratio: number;
    /** 经验覆盖的语义空间估计（用标签聚类近似）*/
    semantic_clusters: number;
  };
}

// === 查询实现 ===

export async function getNetworkHealth(): Promise<NetworkHealthReport> {
  const db = getClient();
  const now = new Date();
  const iso24h = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const iso7d = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();

  // 并行执行所有查询
  const [
    totalExp,
    totalAgents,
    totalVerifications,
    totalExecutables,
    exp24h,
    exp7d,
    contributors24h,
    contributors7d,
    outcomeBreakdown,
    failedCount,
    richLearnedCount,
    verBreakdown,
    verifiedExpCount,
    avgVerPerExp,
    crossAgentVerCount,
    confirmCount,
    agentExpCounts,
    agentVerCounts,
    platformCount,
    tagRows,
    allTagsJson,
    embeddingCount,
  ] = await Promise.all([
    // 基础计数
    db.execute('SELECT COUNT(*) as c FROM experiences').then(r => Number(r.rows[0].c)),
    db.execute('SELECT COUNT(DISTINCT publisher_agent_id) as c FROM experiences').then(r => Number(r.rows[0].c)),
    db.execute('SELECT COUNT(*) as c FROM verifications').then(r => Number(r.rows[0].c)),
    db.execute('SELECT COUNT(*) as c FROM experience_executables').then(r => Number(r.rows[0].c)),

    // 供给侧
    db.execute({ sql: 'SELECT COUNT(*) as c FROM experiences WHERE published_at >= ?', args: [iso24h] }).then(r => Number(r.rows[0].c)),
    db.execute({ sql: 'SELECT COUNT(*) as c FROM experiences WHERE published_at >= ?', args: [iso7d] }).then(r => Number(r.rows[0].c)),
    db.execute({ sql: 'SELECT COUNT(DISTINCT publisher_agent_id) as c FROM experiences WHERE published_at >= ?', args: [iso24h] }).then(r => Number(r.rows[0].c)),
    db.execute({ sql: 'SELECT COUNT(DISTINCT publisher_agent_id) as c FROM experiences WHERE published_at >= ?', args: [iso7d] }).then(r => Number(r.rows[0].c)),

    // 质量
    db.execute('SELECT outcome, COUNT(*) as c FROM experiences GROUP BY outcome').then(r => {
      const m: Record<string, number> = {};
      for (const row of r.rows) m[row.outcome as string] = Number(row.c);
      return m;
    }),
    db.execute("SELECT COUNT(*) as c FROM experiences WHERE outcome = 'failed'").then(r => Number(r.rows[0].c)),
    db.execute("SELECT COUNT(*) as c FROM experiences WHERE LENGTH(learned) >= 50").then(r => Number(r.rows[0].c)),

    // 信任
    db.execute('SELECT result, COUNT(*) as c FROM verifications GROUP BY result').then(r => {
      const m: Record<string, number> = {};
      for (const row of r.rows) m[row.result as string] = Number(row.c);
      return m;
    }),
    db.execute('SELECT COUNT(DISTINCT experience_id) as c FROM verifications').then(r => Number(r.rows[0].c)),
    db.execute('SELECT AVG(cnt) as a FROM (SELECT experience_id, COUNT(*) as cnt FROM verifications GROUP BY experience_id)').then(r => Number(r.rows[0].a) || 0),
    // 跨 agent 验证：验证者 != 发布者 的经验数
    db.execute(`
      SELECT COUNT(DISTINCT v.experience_id) as c
      FROM verifications v
      JOIN experiences e ON v.experience_id = e.id
      WHERE v.verifier_agent_id != e.publisher_agent_id
    `).then(r => Number(r.rows[0].c)),
    db.execute("SELECT COUNT(*) as c FROM verifications WHERE result = 'confirmed'").then(r => Number(r.rows[0].c)),

    // Agent 多样性 — 经验数
    db.execute('SELECT publisher_agent_id as a, COUNT(*) as c FROM experiences GROUP BY publisher_agent_id ORDER BY c DESC').then(r =>
      r.rows.map(row => ({ agent_id: row.a as string, count: Number(row.c) }))
    ),
    // Agent 多样性 — 验证数
    db.execute('SELECT verifier_agent_id as a, COUNT(*) as c FROM verifications GROUP BY verifier_agent_id').then(r => {
      const m = new Map<string, number>();
      for (const row of r.rows) m.set(row.a as string, Number(row.c));
      return m;
    }),
    db.execute('SELECT COUNT(DISTINCT publisher_platform) as c FROM experiences').then(r => Number(r.rows[0].c)),

    // 标签（一次查询，tagRows 和 allTagsJson 共用）
    db.execute('SELECT tags FROM experiences'),

    // （已合并到上一个查询，占位保持解构对齐）
    Promise.resolve(null),

    // Embedding
    db.execute('SELECT COUNT(*) as c FROM experiences WHERE embedding IS NOT NULL').then(r => Number(r.rows[0].c)),
  ]);

  // === 后处理 ===

  // one-shot agent ratio
  const oneShotAgents = agentExpCounts.filter(a => a.count === 1).length;
  const oneShotRatio = totalAgents > 0 ? oneShotAgents / totalAgents : 0;

  // top agents (merge exp + ver counts)
  const topAgents = agentExpCounts.slice(0, 5).map(a => ({
    agent_id: a.agent_id,
    experience_count: a.count,
    verification_count: agentVerCounts.get(a.agent_id) || 0,
  }));

  // 基尼系数
  const counts = agentExpCounts.map(a => a.count).sort((a, b) => a - b);
  const gini = calculateGini(counts);

  // 标签处理
  const tagCounter = new Map<string, number>();
  let totalTagAssignments = 0;
  for (const row of tagRows.rows) {
    try {
      const tags: string[] = JSON.parse(row.tags as string);
      totalTagAssignments += tags.length;
      for (const t of tags) tagCounter.set(t, (tagCounter.get(t) || 0) + 1);
    } catch { /* skip malformed */ }
  }

  const sortedTags = [...tagCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  // 语义聚类近似：用标签共现粗略估计
  // 简单方法：unique tag 数量作为上界
  const uniqueTagCount = tagCounter.size;

  return {
    generated_at: now.toISOString(),
    uptime_seconds: Math.round(process.uptime()),

    totals: {
      experiences: totalExp,
      agents: totalAgents,
      verifications: totalVerifications,
      executables: totalExecutables,
    },

    supply: {
      experiences_24h: exp24h,
      experiences_7d: exp7d,
      unique_contributors_24h: contributors24h,
      unique_contributors_7d: contributors7d,
      avg_experiences_per_agent: totalAgents > 0 ? round2(totalExp / totalAgents) : 0,
      one_shot_agent_ratio: round2(oneShotRatio),
    },

    quality: {
      outcome_breakdown: outcomeBreakdown,
      failure_ratio: totalExp > 0 ? round2(failedCount / totalExp) : 0,
      rich_learned_ratio: totalExp > 0 ? round2(richLearnedCount / totalExp) : 0,
    },

    trust: {
      verification_breakdown: verBreakdown,
      verified_experience_ratio: totalExp > 0 ? round2(verifiedExpCount / totalExp) : 0,
      avg_verifications_per_experience: round2(avgVerPerExp),
      cross_agent_verification_ratio: totalExp > 0 ? round2(crossAgentVerCount / totalExp) : 0,
      confirmation_rate: totalVerifications > 0 ? round2(confirmCount / totalVerifications) : 0,
    },

    diversity: {
      unique_platforms: platformCount,
      top_agents: topAgents,
      contribution_gini: round2(gini),
    },

    tags: {
      total_unique_tags: uniqueTagCount,
      top_tags: sortedTags,
      avg_tags_per_experience: totalExp > 0 ? round2(totalTagAssignments / totalExp) : 0,
    },

    serendipity: {
      indexed_ratio: totalExp > 0 ? round2(embeddingCount / totalExp) : 0,
      semantic_clusters: Math.min(uniqueTagCount, Math.ceil(uniqueTagCount * 0.6)),
    },
  };
}

// === 工具函数 ===

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 基尼系数计算（0=完全均匀，1=完全集中）*/
function calculateGini(sortedValues: number[]): number {
  const n = sortedValues.length;
  if (n <= 1) return 0;
  const mean = sortedValues.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;

  // 标准公式：G = Σ_i Σ_j |x_i - x_j| / (2 * n^2 * mean)
  let diffSum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      diffSum += Math.abs(sortedValues[i] - sortedValues[j]);
    }
  }

  return Math.max(0, Math.min(1, diffSum / (2 * n * n * mean)));
}
