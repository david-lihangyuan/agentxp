/**
 * 双通道语义搜索
 * B5: precision（关键词/tag 精确匹配）+ serendipity（新颖发现）
 *
 * 架构说明：
 * - 超级节点本地没有 embedding API
 * - Precision 通道：title/summary 关键词匹配 + tag 重叠度
 * - Serendipity 通道：tag 多样性 + 时间新鲜度 + 轻微随机扰动（可替换为向量相似度）
 * - score_breakdown 让每条结果可追溯
 */
import type Database from 'better-sqlite3'
import type { Experience, PulseState } from './experience-store.js'
import { rowToExperience } from './experience-store-internal.js'

export interface ScoreBreakdown {
  keyword_score: number    // 关键词匹配得分 [0,1]
  tag_score: number        // tag 重叠得分 [0,1]
  freshness_score: number  // 时间新鲜度 [0,1]
  serendipity_bonus: number // 意外发现加成 [0,1]
  final_score: number      // 最终加权得分 [0,1]
}

export interface SearchResult {
  experience: Experience
  score_breakdown: ScoreBreakdown
  channel: 'precision' | 'serendipity' | 'both'
}

export interface SearchQuery {
  query?: string           // 关键词搜索（title + summary）
  tags?: string[]          // tag 过滤
  operator_pubkey?: string // 限定 operator
  pulse_states?: PulseState[] // 限定 pulse 状态
  limit?: number           // 默认 20
  offset?: number          // 分页
  include_serendipity?: boolean // 是否启用 serendipity 通道（默认 true）
  serendipity_ratio?: number   // serendipity 结果在总数中的比例 [0,1]（默认 0.3）
}

export interface SearchResponse {
  results: SearchResult[]
  total_precision: number
  total_serendipity: number
  query_summary: string
}

// ─────────────────────────────────────────
// 内部评分函数
// ─────────────────────────────────────────

/**
 * 关键词匹配得分：词命中数 / 总词数
 */
function keywordScore(text: string, keywords: string[]): number {
  if (keywords.length === 0) return 0
  const lower = text.toLowerCase()
  const hits = keywords.filter(k => lower.includes(k.toLowerCase()))
  return hits.length / keywords.length
}

/**
 * tag 重叠得分：Jaccard 相似度
 */
function tagScore(expTags: string[], queryTags: string[]): number {
  if (queryTags.length === 0) return 0
  const expSet = new Set(expTags.map(t => t.toLowerCase()))
  const querySet = new Set(queryTags.map(t => t.toLowerCase()))
  const intersection = [...querySet].filter(t => expSet.has(t)).length
  const union = new Set([...expSet, ...querySet]).size
  return union === 0 ? 0 : intersection / union
}

/**
 * 时间新鲜度：越新分数越高
 * 半衰期 30 天
 */
function freshnessScore(createdAt: number): number {
  const ageMs = Date.now() - createdAt
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  const halfLife = 30
  return Math.exp(-Math.log(2) * ageDays / halfLife)
}

/**
 * Serendipity 加成：tag 多样性（和查询 tag 重叠少的反而有加成）
 * 思路：serendipity = 1 - tag_overlap，但限制范围
 */
function serendipityBonus(expTags: string[], queryTags: string[]): number {
  if (queryTags.length === 0) return 0.5  // 无 tag 查询，平均加成
  const overlap = tagScore(expTags, queryTags)
  // 轻微重叠 → 高加成；完全不重叠 → 中等加成；完全重叠 → 无加成
  return Math.max(0, 0.7 - overlap * 0.5)
}

/**
 * 精确通道得分
 */
function precisionScore(
  exp: Experience,
  keywords: string[],
  queryTags: string[],
): number {
  const kw = keywords.length > 0
    ? keywordScore(exp.title + ' ' + exp.summary, keywords)
    : 0
  const tag = tagScore(exp.tags, queryTags)
  // 有关键词时：关键词权重 0.6，tag 权重 0.4
  // 只有 tag 时：tag 权重 1.0
  if (keywords.length > 0 && queryTags.length > 0) {
    return kw * 0.6 + tag * 0.4
  } else if (keywords.length > 0) {
    return kw
  } else {
    return tag
  }
}

/**
 * Serendipity 通道得分
 */
function serendipityChannelScore(
  exp: Experience,
  queryTags: string[],
): number {
  const freshness = freshnessScore(exp.created_at)
  const bonus = serendipityBonus(exp.tags, queryTags)
  return freshness * 0.5 + bonus * 0.5
}

// ─────────────────────────────────────────
// 主搜索函数
// ─────────────────────────────────────────

export function searchExperiences(
  db: Database.Database,
  query: SearchQuery,
): SearchResponse {
  const {
    query: rawQuery = '',
    tags: queryTags = [],
    operator_pubkey,
    pulse_states,
    limit = 20,
    offset = 0,
    include_serendipity = true,
    serendipity_ratio = 0.3,
  } = query

  const keywords = rawQuery
    .split(/\s+/)
    .map(k => k.trim())
    .filter(k => k.length > 0)

  // ── 构建 SQL 查询 ──
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (operator_pubkey) {
    conditions.push('operator_pubkey = ?')
    params.push(operator_pubkey)
  }

  if (pulse_states && pulse_states.length > 0) {
    conditions.push(`pulse_state IN (${pulse_states.map(() => '?').join(', ')})`)
    params.push(...pulse_states)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = db
    .prepare(`SELECT * FROM experiences ${whereClause} ORDER BY created_at DESC LIMIT 500`)
    .all(...params) as Record<string, unknown>[]

  const experiences = rows.map(rowToExperience)

  // ── Precision 通道 ──
  const precisionResults: SearchResult[] = []

  for (const exp of experiences) {
    const kw = keywords.length > 0
      ? keywordScore(exp.title + ' ' + exp.summary, keywords)
      : 0
    const tag = tagScore(exp.tags, queryTags)
    const freshness = freshnessScore(exp.created_at)
    const bonus = serendipityBonus(exp.tags, queryTags)

    const pScore = precisionScore(exp, keywords, queryTags)

    const breakdown: ScoreBreakdown = {
      keyword_score: Math.round(kw * 1000) / 1000,
      tag_score: Math.round(tag * 1000) / 1000,
      freshness_score: Math.round(freshness * 1000) / 1000,
      serendipity_bonus: Math.round(bonus * 1000) / 1000,
      final_score: Math.round(pScore * 1000) / 1000,
    }

    // precision 通道：得分 > 0 的才进入
    if (pScore > 0 || (keywords.length === 0 && queryTags.length === 0)) {
      precisionResults.push({
        experience: exp,
        score_breakdown: breakdown,
        channel: 'precision',
      })
    }
  }

  // 按精确得分排序
  precisionResults.sort((a, b) => b.score_breakdown.final_score - a.score_breakdown.final_score)

  // ── Serendipity 通道 ──
  const serendipityResults: SearchResult[] = []

  if (include_serendipity) {
    const precisionIds = new Set(precisionResults.map(r => r.experience.id))

    for (const exp of experiences) {
      // 跳过已在 precision 结果中的（除非我们要标记为 both）
      const sScore = serendipityChannelScore(exp, queryTags)
      const kw = keywords.length > 0
        ? keywordScore(exp.title + ' ' + exp.summary, keywords)
        : 0
      const tag = tagScore(exp.tags, queryTags)
      const freshness = freshnessScore(exp.created_at)
      const bonus = serendipityBonus(exp.tags, queryTags)

      if (!precisionIds.has(exp.id) && sScore > 0.2) {
        serendipityResults.push({
          experience: exp,
          score_breakdown: {
            keyword_score: Math.round(kw * 1000) / 1000,
            tag_score: Math.round(tag * 1000) / 1000,
            freshness_score: Math.round(freshness * 1000) / 1000,
            serendipity_bonus: Math.round(bonus * 1000) / 1000,
            final_score: Math.round(sScore * 1000) / 1000,
          },
          channel: 'serendipity',
        })
      }
    }

    serendipityResults.sort((a, b) => b.score_breakdown.final_score - a.score_breakdown.final_score)
  }

  // ── 合并结果 ──
  const totalLimit = limit
  const serendipityCount = include_serendipity
    ? Math.floor(totalLimit * serendipity_ratio)
    : 0
  const precisionCount = totalLimit - serendipityCount

  const finalPrecision = precisionResults.slice(0, precisionCount)
  const finalSerendipity = serendipityResults.slice(0, serendipityCount)

  // 合并并按 offset 分页
  const merged = [...finalPrecision, ...finalSerendipity]

  const paged = merged.slice(offset, offset + totalLimit)

  // 构建查询摘要
  const queryParts = []
  if (keywords.length > 0) queryParts.push(`关键词: "${keywords.join(' ')}"`)
  if (queryTags.length > 0) queryParts.push(`标签: [${queryTags.join(', ')}]`)
  if (operator_pubkey) queryParts.push(`operator: ${operator_pubkey.slice(0, 8)}...`)
  const querySummary = queryParts.length > 0 ? queryParts.join(', ') : '全量搜索'

  return {
    results: paged,
    total_precision: precisionResults.length,
    total_serendipity: serendipityResults.length,
    query_summary: querySummary,
  }
}
