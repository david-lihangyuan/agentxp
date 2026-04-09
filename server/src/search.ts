/**
 * 双通道搜索算法
 * precision：高相似度精确匹配
 * serendipity：中等相似度意外发现
 */

import { getAllEmbeddings, getExperiencesByIds, getVerificationSummary } from './db.js';
import { getEmbedding, experienceToText, cosineSimilarity } from './embedding.js';
import { applyBaseFilters, timeDecay } from './base-filters.js';
import type { SearchRequest, SearchResponse, SearchResultItem, SerendipityResultItem, Experience } from './types.js';

// SPEC §4.1 信任分计算
function trustScore(exp: Experience, verSummary: { confirmed: number; denied: number; conditional: number }): number {
  // 基础分
  let base = exp.trust?.operator_endorsed ? 0.5 : 0.3;
  // 验证加成
  base += Math.min(verSummary.confirmed * 0.1, 0.3);
  base -= verSummary.denied * 0.15;
  base += verSummary.conditional * 0.05;
  // 时间衰减（半衰期 180 天）
  const decay = timeDecay(exp.published_at, 180);
  return Math.max(0, Math.min(1, base * decay));
}

export async function search(req: SearchRequest): Promise<SearchResponse> {
  const {
    query,
    tags,
    filters,
    channels = { precision: true, serendipity: true, serendipity_weight: 0.3 },
    limit = 10,
  } = req;

  // 1. query → 嵌入向量
  const queryEmbedding = await getEmbedding(query);

  // 2. 取所有经验的 embedding
  const allEmbeddings = await getAllEmbeddings();
  if (allEmbeddings.length === 0) {
    return { precision: [], serendipity: [], total_available: 0 };
  }
  if (allEmbeddings.length > 5000) {
    console.warn(`⚠️  搜索性能预警：当前 ${allEmbeddings.length} 条经验，暴力向量扫描可能变慢。建议超过 10K 条时接入向量索引。`);
  }

  // 3. 计算相似度
  const scored = allEmbeddings.map(({ id, embedding }) => ({
    id,
    similarity: cosineSimilarity(queryEmbedding, embedding),
  }));

  // 4. 获取经验详情（批量）
  const allIds = scored.map(s => s.id);
  const experiences = await getExperiencesByIds(allIds);
  const expMap = new Map(experiences.map(e => [e.id, e]));

  // 5. 验证缓存 + 应用过滤器
  const verSumCache = new Map<string, { confirmed: number; denied: number; conditional: number; total: number }>();
  const cachedGetVerSum = async (id: string) => {
    if (verSumCache.has(id)) return verSumCache.get(id)!;
    const sum = await getVerificationSummary(id);
    verSumCache.set(id, sum);
    return sum;
  };

  const filterResults = await Promise.all(
    scored.map(async ({ id }) => {
      const exp = expMap.get(id);
      if (!exp) return false;

      // 场景特定过滤
      if (filters?.outcome && filters.outcome !== 'any' && exp.core.outcome !== filters.outcome) return false;
      if (filters?.platform && exp.publisher.platform !== filters.platform) return false;

      // 通用基础过滤（max_age_days, ttl_days, min_verifications, tags）
      return applyBaseFilters(
        { id: exp.id, published_at: exp.published_at, ttl_days: exp.ttl_days, tags: exp.tags },
        filters ? { max_age_days: filters.max_age_days ?? undefined, min_verifications: filters.min_verifications } : undefined,
        tags ?? undefined,
        cachedGetVerSum,
      );
    })
  );

  const filtered = scored.filter((_, i) => filterResults[i]);

  // 6. 分通道

  // === precision channel ===
  const precisionResults: SearchResultItem[] = [];
  if (channels.precision !== false) {
    const precisionCandidates = filtered
      .filter(s => s.similarity >= 0.5)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    for (const { id, similarity } of precisionCandidates) {
      const exp = expMap.get(id)!;
      const verSum = await cachedGetVerSum(id);
      const trust = trustScore(exp, verSum);
      // SPEC: match_score × 0.7 + trust_score × 0.3
      const finalScore = similarity * 0.7 + trust * 0.3;

      precisionResults.push({
        experience_id: id,
        match_score: Math.round(finalScore * 1000) / 1000,
        experience: exp,
        verification_summary: verSum,
      });
    }

    precisionResults.sort((a, b) => b.match_score - a.match_score);
  }

  // === serendipity channel ===
  const serendipityResults: SerendipityResultItem[] = [];
  if (channels.serendipity !== false) {
    // SPEC: 相似度 0.25-0.55 区间
    // 去重：排除已在 precision 通道中的经验
    const precisionIds = new Set(precisionResults.map(r => r.experience_id));
    const serendipityCandidates = filtered
      .filter(s => s.similarity >= 0.25 && s.similarity <= 0.55 && !precisionIds.has(s.id))
      .sort((a, b) => b.similarity - a.similarity);

    // 预计算查询标签集合，用于 reason 生成
    const queryTags = new Set(tags ?? []);

    for (const { id, similarity } of serendipityCandidates.slice(0, 10)) {
      const exp = expMap.get(id)!;
      const verSum = await cachedGetVerSum(id);

      // serendipity_score 加成 + reason 生成
      // 优先级：失败警告 > 跨 agent 验证 > 标签连接 > 兜底
      let serendipityBonus = 0;
      let reason = '';

      // 标签交集信息（多个分支共用）
      const sharedTags = queryTags.size > 0
        ? exp.tags.filter(t => queryTags.has(t))
        : [];
      const tagHint = sharedTags.length > 0
        ? `（共同标签：${sharedTags.join(', ')}）`
        : '';

      if (exp.core.outcome === 'failed') {
        // 失败经验：先说"他做了什么"，再说"教训是什么"
        serendipityBonus += 0.2;
        reason = `⚠️ 有 agent 做了类似的事但失败了："${exp.core.what.slice(0, 60)}"——教训：${exp.core.learned.slice(0, 80)}${tagHint}`;
      } else if (verSum.confirmed >= 2) {
        // 高可信经验：强调被多人验证 + 具体教训
        serendipityBonus += 0.15;
        reason = `${verSum.confirmed} 个 agent 验证过这条经验${tagHint}："${exp.core.learned.slice(0, 80)}"`;
      } else if (sharedTags.length > 0) {
        // 有标签连接：说明连接点在哪
        serendipityBonus += 0.05;
        reason = `和你的场景共享 ${sharedTags.join('/')} 标签——"${exp.core.what.slice(0, 60)}"`;
      } else {
        // 兜底：用 what 而不是 learned 让用户先判断相关性
        reason = `不同场景但可能有启发："${exp.core.what.slice(0, 60)}"——${exp.core.learned.slice(0, 60)}`;
      }

      const weight = channels.serendipity_weight ?? 0.3;
      const finalScore = (similarity + serendipityBonus) * weight;

      serendipityResults.push({
        experience_id: id,
        match_score: Math.round(finalScore * 1000) / 1000,
        serendipity_reason: reason,
        experience: exp,
        verification_summary: verSum,
      });
    }

    serendipityResults.sort((a, b) => b.match_score - a.match_score);
    serendipityResults.splice(3); // 最多 3 个
  }

  return {
    precision: precisionResults,
    serendipity: serendipityResults,
    total_available: filtered.length,
  };
}
