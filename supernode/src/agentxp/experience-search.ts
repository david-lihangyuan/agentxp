// Supernode AgentXP — Dual-Channel Search
// Precision: exact tag match + embedding similarity (indexed only)
// Serendipity: pre-computed batch results from cache
// Graceful degradation, scope-aware, private isolation, no raw vectors in responses.

import { Database } from 'bun:sqlite'
import { logger } from '../logger'
import type { ExperienceRecord } from './experience-store'

export interface SearchQuery {
  query: string
  tags?: string[]
  /** Caller's environment scope for scope-aware matching */
  env?: {
    platform?: string
    versions?: string[]
    context?: string
  }
  /** Filter by outcome */
  filter?: {
    outcome?: string
  }
  /** Operator pubkey — for private isolation */
  operatorPubkey?: string
  limit?: number
}

export interface SearchResult {
  experience: Omit<ExperienceRecord, 'embedding'>
  match_score: number
  scope_match?: boolean
  scope_warning?: string
  score_breakdown: {
    tag_score: number
    embedding_score: number
    scope_boost: number
  }
}

export interface SearchResponse {
  precision: SearchResult[]
  serendipity: SearchResult[]
  degraded: boolean
  message?: string
  total: number
}

/** Cosine similarity between two embedding vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** Simple keyword tokenizer for tag broadening. */
function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

/** Check if an experience's scope matches the query environment. */
function checkScope(
  scopeJson: string | null,
  env?: SearchQuery['env']
): { match: boolean; warning?: string } {
  if (!scopeJson || !env) return { match: true }

  try {
    const scope = JSON.parse(scopeJson) as {
      platforms?: string[]
      versions?: string[]
      context?: string
    }

    let warning: string | undefined

    if (scope.platforms && env.platform && !scope.platforms.includes(env.platform)) {
      warning = `validated on ${scope.platforms.join(', ')}, you are on ${env.platform} — may not apply`
      return { match: false, warning }
    }

    if (scope.context && env.context && scope.context !== env.context) {
      warning = `validated in ${scope.context} context, you are in ${env.context}`
      return { match: false, warning }
    }

    return { match: true }
  } catch {
    return { match: true }
  }
}

export class ExperienceSearch {
  constructor(
    private db: Database,
    private generateQueryEmbedding?: (text: string) => Promise<number[]>
  ) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const limit = query.limit ?? 20
    const operatorPubkey = query.operatorPubkey

    // Build base SQL conditions for privacy isolation
    const privacyConditions = buildPrivacyConditions(operatorPubkey)

    // Outcome filter
    const outcomeFilter = query.filter?.outcome
      ? `AND e.outcome = '${query.filter.outcome.replace(/'/g, "''")}'`
      : ''

    // --- TIER 1: Exact tag match ---
    let precisionResults = await this.exactTagSearch(
      query,
      privacyConditions,
      outcomeFilter,
      limit
    )

    let degraded = false
    let degradeMessage: string | undefined

    // --- Graceful degradation ---
    if (precisionResults.length === 0) {
      degraded = true
      // Try keyword broadening
      const keywords = extractKeywords(query.query)
      if (keywords.length > 0) {
        precisionResults = await this.keywordSearch(
          keywords,
          privacyConditions,
          outcomeFilter,
          limit
        )
      }
    }

    if (precisionResults.length === 0 && this.generateQueryEmbedding) {
      // Semantic fallback
      precisionResults = await this.semanticSearch(
        query,
        privacyConditions,
        outcomeFilter,
        limit
      )
    }

    if (precisionResults.length === 0) {
      degradeMessage = 'no experiences found yet — your exploration will be the first'
    }

    // Scope-aware scoring
    const scoredPrecision = precisionResults.map((r) => {
      const scopeCheck = checkScope(r.scope, query.env)
      const scopeBoost = scopeCheck.match ? 0.1 : 0
      return {
        experience: stripEmbedding(r),
        match_score: r._raw_score + scopeBoost,
        scope_match: scopeCheck.match,
        scope_warning: scopeCheck.warning,
        score_breakdown: {
          tag_score: r._tag_score ?? 0,
          embedding_score: r._embedding_score ?? 0,
          scope_boost: scopeBoost,
        },
      }
    })

    // Sort by match_score descending
    scoredPrecision.sort((a, b) => b.match_score - a.match_score)

    // --- Serendipity channel: cross-domain from cache ---
    const serendipityResults = await this.serendipitySearch(
      query,
      privacyConditions,
      limit,
      scoredPrecision.map((r) => r.experience.id)
    )

    logger.info('Search completed', {
      query: query.query,
      precision_count: scoredPrecision.length,
      serendipity_count: serendipityResults.length,
      degraded,
    })

    return {
      precision: scoredPrecision,
      serendipity: serendipityResults,
      degraded,
      message: degradeMessage,
      total: scoredPrecision.length + serendipityResults.length,
    }
  }

  private async exactTagSearch(
    query: SearchQuery,
    privacyConditions: string,
    outcomeFilter: string,
    limit: number
  ): Promise<InternalResult[]> {
    if (!query.tags || query.tags.length === 0) return []

    const tagConditions = query.tags
      .map((t) => `e.tags LIKE '%"${t.replace(/'/g, "''")}"%'`)
      .join(' AND ')

    const sql = `
      SELECT e.* FROM experiences e
      WHERE ${tagConditions}
      ${privacyConditions}
      ${outcomeFilter}
      AND e.embedding_status = 'indexed'
      ORDER BY e.created_at DESC
      LIMIT ?
    `
    const rows = this.db.query(sql).all(limit) as ExperienceRecord[]
    return rows.map((r) => ({
      ...r,
      _raw_score: 0.8,
      _tag_score: 0.8,
      _embedding_score: 0,
    }))
  }

  private async keywordSearch(
    keywords: string[],
    privacyConditions: string,
    outcomeFilter: string,
    limit: number
  ): Promise<InternalResult[]> {
    const keywordConditions = keywords
      .map((k) => {
        const safe = k.replace(/'/g, "''")
        return `(e.what LIKE '%${safe}%' OR e.tried LIKE '%${safe}%' OR e.learned LIKE '%${safe}%' OR e.tags LIKE '%${safe}%')`
      })
      .join(' OR ')

    if (!keywordConditions) return []

    const sql = `
      SELECT e.* FROM experiences e
      WHERE (${keywordConditions})
      ${privacyConditions}
      ${outcomeFilter}
      ORDER BY e.created_at DESC
      LIMIT ?
    `
    const rows = this.db.query(sql).all(limit) as ExperienceRecord[]
    return rows.map((r) => ({
      ...r,
      _raw_score: 0.5,
      _tag_score: 0,
      _embedding_score: 0,
    }))
  }

  private async semanticSearch(
    query: SearchQuery,
    privacyConditions: string,
    outcomeFilter: string,
    limit: number
  ): Promise<InternalResult[]> {
    if (!this.generateQueryEmbedding) return []

    try {
      const queryEmbedding = await this.generateQueryEmbedding(query.query)

      // Fetch all indexed experiences and compute similarity in-memory
      // (In production: use vector index like sqlite-vss or pgvector)
      const sql = `
        SELECT e.* FROM experiences e
        WHERE e.embedding_status = 'indexed'
        AND e.embedding IS NOT NULL
        ${privacyConditions}
        ${outcomeFilter}
      `
      const rows = this.db.query(sql).all() as ExperienceRecord[]

      const scored = rows
        .map((r) => {
          try {
            const emb = JSON.parse(r.embedding!) as number[]
            const score = cosineSimilarity(queryEmbedding, emb)
            return { ...r, _raw_score: score, _tag_score: 0, _embedding_score: score }
          } catch {
            return null
          }
        })
        .filter((r): r is InternalResult => r !== null && r._raw_score > 0.3)
        .sort((a, b) => b._raw_score - a._raw_score)
        .slice(0, limit)

      return scored
    } catch (err) {
      logger.error('Semantic search failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  }

  private async serendipitySearch(
    query: SearchQuery,
    privacyConditions: string,
    limit: number,
    excludeIds: number[]
  ): Promise<SearchResult[]> {
    // Serendipity: find experiences from different domains/tags
    // For now: select recent public experiences not already in precision results
    const excludeClause =
      excludeIds.length > 0 ? `AND e.id NOT IN (${excludeIds.join(',')})` : ''

    const sql = `
      SELECT e.* FROM experiences e
      WHERE e.visibility = 'public'
      AND e.embedding_status = 'indexed'
      ${excludeClause}
      ORDER BY RANDOM()
      LIMIT ?
    `
    const rows = this.db.query(sql).all(Math.min(limit, 5)) as ExperienceRecord[]

    return rows.map((r) => ({
      experience: stripEmbedding(r),
      match_score: 0.3,
      scope_match: undefined,
      score_breakdown: {
        tag_score: 0,
        embedding_score: 0,
        scope_boost: 0,
      },
    }))
  }
}

/** Build SQL WHERE conditions for privacy isolation. */
function buildPrivacyConditions(operatorPubkey?: string): string {
  if (!operatorPubkey) {
    return "AND e.visibility = 'public'"
  }
  // Operator sees their own private + all public
  return `AND (e.visibility = 'public' OR e.operator_pubkey = '${operatorPubkey.replace(/'/g, "''")}')`
}

/** Remove raw embedding vector from response (never expose). */
function stripEmbedding(r: ExperienceRecord): Omit<ExperienceRecord, 'embedding'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { embedding, ...rest } = r
  return rest
}

interface InternalResult extends ExperienceRecord {
  _raw_score: number
  _tag_score: number
  _embedding_score: number
}
