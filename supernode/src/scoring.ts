/**
 * C3 - 积分计算（Experience Impact Score）
 * 
 * 防作弊宪章（核心原则）：
 * 任何积分都不能由单方面行为获得。必须有独立第三方的行为参与。
 * 
 * 积分规则：
 * - 发布经验 +0（发布本身不值钱）
 * - 被不同 operator 搜索命中 +1（同 operator 不计，每条经验每天上限 +5，同一 searcher 不重复计）
 * - 被不同 operator 验证 confirmed +5（同 operator 不计，同一 verifier 不重复计）
 * - 被不同 operator 引用 +10（自引用不计，同一 citer 不重复计）
 */
import type Database from 'better-sqlite3'

// ─── 类型 ───

export type ScoringEventType = 'search_hit' | 'verification' | 'citation'

export interface ScoreLedgerEntry {
  id: number
  operator_pubkey: string   // 积分归属者（经验发布者的 operator）
  experience_id: string
  event_type: ScoringEventType
  points: number
  actor_pubkey: string      // 触发者
  created_at: number
}

// ─── Schema ───

/**
 * 初始化积分 ledger 表
 */
export function initScoringSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS score_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_pubkey TEXT NOT NULL,
      experience_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('search_hit', 'verification', 'citation')),
      points INTEGER NOT NULL,
      actor_pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_score_operator ON score_ledger(operator_pubkey);
    CREATE INDEX IF NOT EXISTS idx_score_exp_id ON score_ledger(experience_id);
    CREATE INDEX IF NOT EXISTS idx_score_event_type ON score_ledger(event_type);
    CREATE INDEX IF NOT EXISTS idx_score_created ON score_ledger(created_at);

    -- 去重：同一 (experience_id, event_type, actor_pubkey) 组合只记一次
    -- 除了 search_hit 的每日限额逻辑（在代码层处理）
    CREATE UNIQUE INDEX IF NOT EXISTS idx_score_dedup
      ON score_ledger(experience_id, event_type, actor_pubkey);
  `)
}

// ─── 内部工具 ───

/** 查询某条经验的发布者 operator pubkey */
function getExperienceOwner(db: Database.Database, experienceId: string): string | null {
  const row = db
    .prepare('SELECT operator_pubkey FROM experiences WHERE id = ?')
    .get(experienceId) as { operator_pubkey: string } | undefined
  return row?.operator_pubkey ?? null
}

/** 检查今天 (UTC) 该经验的 search_hit 积分已记了多少次 */
function todaySearchHitCount(db: Database.Database, experienceId: string): number {
  // 今天 UTC 的开始时间（毫秒）
  const now = new Date()
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  const row = db
    .prepare(`
      SELECT COUNT(*) as cnt FROM score_ledger
      WHERE experience_id = ? AND event_type = 'search_hit' AND created_at >= ?
    `)
    .get(experienceId, todayStart) as { cnt: number }

  return row.cnt
}

/** 记录一条积分到 ledger（幂等：同一组合已存在则忽略） */
function insertLedger(
  db: Database.Database,
  operatorPubkey: string,
  experienceId: string,
  eventType: ScoringEventType,
  points: number,
  actorPubkey: string,
): boolean {
  try {
    const info = db.prepare(`
      INSERT OR IGNORE INTO score_ledger
        (operator_pubkey, experience_id, event_type, points, actor_pubkey, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(operatorPubkey, experienceId, eventType, points, actorPubkey, Date.now())
    return info.changes > 0
  } catch {
    return false
  }
}

// ─── 积分函数 ───

/**
 * 记录搜索命中积分（+1）
 * - 同 operator 不计
 * - 同一 searcher 对同一经验不重复计
 * - 每条经验每天上限 +5
 * @returns 实际积分（0 或 1）
 */
export function recordSearchHitScore(
  db: Database.Database,
  experienceId: string,
  searcherPubkey: string,
): number {
  const owner = getExperienceOwner(db, experienceId)
  if (!owner) return 0

  // 同 operator 不计
  if (owner === searcherPubkey) return 0

  // 每日上限检查（先于去重，因为即使该 actor 之前没搜过，也可能已达上限）
  const todayCount = todaySearchHitCount(db, experienceId)
  if (todayCount >= 5) return 0

  // 尝试插入（去重索引会拦截同一 searcher 重复）
  const inserted = insertLedger(db, owner, experienceId, 'search_hit', 1, searcherPubkey)
  return inserted ? 1 : 0
}

/**
 * 记录验证积分（confirmed +5，denied +0）
 * - 同 operator 不计
 * - 同一 verifier 对同一经验不重复计
 * @returns 实际积分（0 或 5）
 */
export function recordVerificationScore(
  db: Database.Database,
  experienceId: string,
  verifierPubkey: string,
  result: 'confirmed' | 'denied',
): number {
  const owner = getExperienceOwner(db, experienceId)
  if (!owner) return 0

  // 同 operator 不计
  if (owner === verifierPubkey) return 0

  // denied 不计分（但也不报错）
  if (result !== 'confirmed') return 0

  const inserted = insertLedger(db, owner, experienceId, 'verification', 5, verifierPubkey)
  return inserted ? 5 : 0
}

/**
 * 记录引用积分（+10）
 * - 同 operator 自引用不计
 * - 同一 citer 对同一经验不重复计
 * @returns 实际积分（0 或 10）
 */
export function recordCitationScore(
  db: Database.Database,
  experienceId: string,
  citerPubkey: string,
): number {
  const owner = getExperienceOwner(db, experienceId)
  if (!owner) return 0

  // 自引用不计
  if (owner === citerPubkey) return 0

  const inserted = insertLedger(db, owner, experienceId, 'citation', 10, citerPubkey)
  return inserted ? 10 : 0
}

// ─── 查询函数 ───

/**
 * 获取某 operator 的总积分
 */
export function getScore(db: Database.Database, operatorPubkey: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(points), 0) as total FROM score_ledger WHERE operator_pubkey = ?')
    .get(operatorPubkey) as { total: number }
  return row.total
}

/**
 * 获取某 operator 的积分明细（按时间升序）
 */
export function getScoreLedger(
  db: Database.Database,
  operatorPubkey: string,
  since?: number,
): ScoreLedgerEntry[] {
  if (since !== undefined) {
    const rows = db
      .prepare('SELECT * FROM score_ledger WHERE operator_pubkey = ? AND created_at > ? ORDER BY created_at ASC')
      .all(operatorPubkey, since) as Record<string, unknown>[]
    return rows.map(rowToEntry)
  }

  const rows = db
    .prepare('SELECT * FROM score_ledger WHERE operator_pubkey = ? ORDER BY created_at ASC')
    .all(operatorPubkey) as Record<string, unknown>[]
  return rows.map(rowToEntry)
}

// ─── 内部行转换 ───

function rowToEntry(row: Record<string, unknown>): ScoreLedgerEntry {
  return {
    id: row.id as number,
    operator_pubkey: row.operator_pubkey as string,
    experience_id: row.experience_id as string,
    event_type: row.event_type as ScoringEventType,
    points: row.points as number,
    actor_pubkey: row.actor_pubkey as string,
    created_at: row.created_at as number,
  }
}
