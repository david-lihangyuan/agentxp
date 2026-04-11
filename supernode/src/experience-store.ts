/**
 * 经验发布与存储
 * B4: intent.broadcast 事件（type=experience）→ 解析内容 → 存入 experiences 表 → pulse 初始化
 */
import type Database from 'better-sqlite3'
import type { SerendipEvent } from '@serendip/protocol'
import { rowToExperience } from './experience-store-internal.js'

// Pulse 状态：dormant → discovered → verified → propagating
export type PulseState = 'dormant' | 'discovered' | 'verified' | 'propagating'

export interface Experience {
  id: string              // experience 唯一 ID（由 event.id 派生）
  event_id: string        // 原始事件 ID
  operator_pubkey: string // 发布者公钥
  title: string
  summary: string
  tags: string[]
  difficulty?: string     // easy | medium | hard
  outcome?: string        // success | failure | partial
  embedding?: number[]    // 向量（stub，后续插入）
  pulse_state: PulseState
  created_at: number
  updated_at: number
}

export interface PublishResult {
  ok: boolean
  error?: string
  experienceId?: string
}

/**
 * 初始化 experiences 表和 pulse 状态表
 */
export function initExperiencesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      operator_pubkey TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      difficulty TEXT CHECK(difficulty IN ('easy', 'medium', 'hard', NULL)),
      outcome TEXT CHECK(outcome IN ('success', 'failure', 'partial', NULL)),
      embedding TEXT,
      visibility TEXT NOT NULL DEFAULT 'public'
        CHECK(visibility IN ('public', 'private')),
      pulse_state TEXT NOT NULL DEFAULT 'dormant'
        CHECK(pulse_state IN ('dormant', 'discovered', 'verified', 'propagating')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_exp_operator ON experiences(operator_pubkey);
    CREATE INDEX IF NOT EXISTS idx_exp_pulse ON experiences(pulse_state);
    CREATE INDEX IF NOT EXISTS idx_exp_created ON experiences(created_at);
    CREATE INDEX IF NOT EXISTS idx_exp_tags ON experiences(tags);
  `)
}

/**
 * 从 intent.broadcast 事件发布一条经验
 * - 要求 event.kind === 'intent.broadcast'
 * - 要求 event.content.type === 'experience'
 * - 要求 content.data 或 content 本身包含 title + summary
 * - pulse 初始化为 dormant
 */
export function publishExperience(
  db: Database.Database,
  event: SerendipEvent,
): PublishResult {
  // 只处理 intent.broadcast
  if (event.kind !== 'intent.broadcast') {
    return { ok: false, error: `Wrong event kind: expected 'intent.broadcast', got '${event.kind}'` }
  }

  // 解析 content——v3 IntentPayload 结构: { type, data, summary?, tags? }
  const content = event.content as Record<string, unknown>
  if (!content || typeof content !== 'object') {
    return { ok: false, error: 'Invalid content: must be an object' }
  }

  // v3: 应用层通过 content.data 携带经验详情
  const data = (typeof content.data === 'object' && content.data !== null)
    ? content.data as Record<string, unknown>
    : content  // 兼容旧格式（content 直接包含 title/summary）

  // 必填字段：title 从 data 里取
  if (typeof data.title !== 'string' || data.title.trim() === '') {
    return { ok: false, error: 'Invalid content: title is required' }
  }
  // summary 优先从 data 里取，fallback 到 content.summary
  const rawSummary = typeof data.summary === 'string' ? data.summary
    : typeof content.summary === 'string' ? content.summary
    : ''
  if (rawSummary.trim() === '') {
    return { ok: false, error: 'Invalid content: summary is required' }
  }

  const title = data.title.trim()
  const summary = rawSummary.trim()

  // 可选字段：tags 从 data 或 content.tags 取
  const rawTags = Array.isArray(data.tags) ? data.tags
    : Array.isArray(content.tags) ? content.tags
    : []
  const tags = (rawTags as unknown[]).filter((t): t is string => typeof t === 'string')

  const rawDifficulty = data.difficulty ?? content.difficulty
  const difficulty = ['easy', 'medium', 'hard'].includes(rawDifficulty as string)
    ? (rawDifficulty as string)
    : null

  const rawOutcome = data.outcome ?? content.outcome
  const outcome = ['success', 'failure', 'partial'].includes(rawOutcome as string)
    ? (rawOutcome as string)
    : null

  // experience ID = event ID（1:1 映射）
  const experienceId = event.id
  const now = Date.now()

  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO experiences
        (id, event_id, operator_pubkey, title, summary, tags, difficulty, outcome,
         embedding, pulse_state, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'dormant', ?, ?)
    `)
    const info = stmt.run(
      experienceId,
      event.id,
      event.pubkey,
      title,
      summary,
      JSON.stringify(tags),
      difficulty,
      outcome,
      event.created_at,
      now,
    )

    // OR IGNORE 时 changes = 0 表示已存在（幂等）
    if (info.changes === 0) {
      // 已存在，幂等成功
      return { ok: true, experienceId }
    }

    return { ok: true, experienceId }
  } catch (err) {
    return { ok: false, error: `Storage failed: ${String(err)}` }
  }
}

/**
 * 获取单条经验
 */
export function getExperience(
  db: Database.Database,
  id: string,
): Experience | null {
  const row = db
    .prepare('SELECT * FROM experiences WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToExperience(row)
}

/**
 * 按 operator 查询经验列表
 */
export function listExperiencesByOperator(
  db: Database.Database,
  operatorPubkey: string,
  limit = 50,
  offset = 0,
): Experience[] {
  const rows = db
    .prepare(
      'SELECT * FROM experiences WHERE operator_pubkey = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    .all(operatorPubkey, limit, offset) as Record<string, unknown>[]
  return rows.map(rowToExperience)
}

/**
 * 按 pulse_state 查询（Phase 2C 用）
 */
export function listExperiencesByPulse(
  db: Database.Database,
  state: PulseState,
  limit = 50,
): Experience[] {
  const rows = db
    .prepare(
      'SELECT * FROM experiences WHERE pulse_state = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(state, limit) as Record<string, unknown>[]
  return rows.map(rowToExperience)
}

/**
 * 更新 pulse_state（Phase 2C 用）
 */
export function updatePulseState(
  db: Database.Database,
  id: string,
  state: PulseState,
): boolean {
  const info = db
    .prepare('UPDATE experiences SET pulse_state = ?, updated_at = ? WHERE id = ?')
    .run(state, Date.now(), id)
  return info.changes > 0
}

/**
 * 更新 embedding（stub，供后续 embedding 服务调用）
 */
export function updateEmbedding(
  db: Database.Database,
  id: string,
  embedding: number[],
): boolean {
  const info = db
    .prepare('UPDATE experiences SET embedding = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(embedding), Date.now(), id)
  return info.changes > 0
}

// rowToExperience 在 experience-store-internal.ts，此处重新导出供外部使用
export { rowToExperience } from './experience-store-internal.js'
