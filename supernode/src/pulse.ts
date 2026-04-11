/**
 * C1 - Pulse 状态机
 * Experience Pulse：经验的生命状态追踪
 * 
 * 状态流转：dormant → discovered → verified → propagating
 * 规则：状态只进不退。同 operator 的操作不触发状态变迁。
 * 每次事件（含不触发状态变迁的）都记录到 pulse_events 表。
 */
import type Database from 'better-sqlite3'
import type { PulseState } from './experience-store.js'

// ─── 类型 ───

export type PulseEventType = 'search_hit' | 'verification' | 'citation'
export type VerificationResult = 'confirmed' | 'denied'

export interface PulseEvent {
  id: number
  experience_id: string
  event_type: PulseEventType
  from_state: PulseState
  to_state: PulseState
  actor_pubkey: string    // 触发者的 pubkey
  context: string         // 人类可读描述
  created_at: number
}

// ─── 状态等级（用于比较，只进不退）───

const STATE_LEVEL: Record<PulseState, number> = {
  dormant: 0,
  discovered: 1,
  verified: 2,
  propagating: 3,
}

// ─── Schema ───

/**
 * 初始化 pulse_events 表
 */
export function initPulseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pulse_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experience_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('search_hit', 'verification', 'citation')),
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      actor_pubkey TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (experience_id) REFERENCES experiences(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pulse_exp_id ON pulse_events(experience_id);
    CREATE INDEX IF NOT EXISTS idx_pulse_created ON pulse_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_pulse_actor ON pulse_events(actor_pubkey);
  `)
}

// ─── 内部工具 ───

interface ExperienceRow {
  id: string
  operator_pubkey: string
  pulse_state: PulseState
}

function getExperienceForPulse(db: Database.Database, experienceId: string): ExperienceRow | null {
  const row = db
    .prepare('SELECT id, operator_pubkey, pulse_state FROM experiences WHERE id = ?')
    .get(experienceId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    operator_pubkey: row.operator_pubkey as string,
    pulse_state: row.pulse_state as PulseState,
  }
}

function recordPulseEvent(
  db: Database.Database,
  experienceId: string,
  eventType: PulseEventType,
  fromState: PulseState,
  toState: PulseState,
  actorPubkey: string,
  context: string,
): void {
  db.prepare(`
    INSERT INTO pulse_events (experience_id, event_type, from_state, to_state, actor_pubkey, context, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(experienceId, eventType, fromState, toState, actorPubkey, context, Date.now())
}

function updateState(db: Database.Database, experienceId: string, newState: PulseState): void {
  db.prepare('UPDATE experiences SET pulse_state = ?, updated_at = ? WHERE id = ?')
    .run(newState, Date.now(), experienceId)
}

// ─── 状态流转函数 ───

/**
 * 搜索命中触发：dormant → discovered
 * - 同 operator 搜索自己的经验不触发
 * - 已经 >= discovered 时不变状态，但仍记录 event
 * @returns true 如果状态发生了变化
 */
export function transitionOnSearchHit(
  db: Database.Database,
  experienceId: string,
  searcherPubkey: string,
): boolean {
  const exp = getExperienceForPulse(db, experienceId)
  if (!exp) return false

  // 同 operator 不触发
  if (exp.operator_pubkey === searcherPubkey) return false

  const currentLevel = STATE_LEVEL[exp.pulse_state]
  const targetLevel = STATE_LEVEL['discovered']
  const stateChanged = currentLevel < targetLevel

  const newState: PulseState = stateChanged ? 'discovered' : exp.pulse_state

  if (stateChanged) {
    updateState(db, experienceId, newState)
  }

  const context = stateChanged
    ? `经验被 ${searcherPubkey.slice(0, 8)}... 搜索命中，状态从 ${exp.pulse_state} 提升到 discovered`
    : `经验被 ${searcherPubkey.slice(0, 8)}... 搜索命中（状态保持 ${exp.pulse_state}）`

  recordPulseEvent(db, experienceId, 'search_hit', exp.pulse_state, newState, searcherPubkey, context)

  return stateChanged
}

/**
 * 验证触发：→ verified（仅 confirmed 才提升状态）
 * - 同 operator 验证不触发
 * - denied 验证记录 event 但不提升状态
 * - 已经 >= verified 时不变状态
 * @returns true 如果状态发生了变化
 */
export function transitionOnVerify(
  db: Database.Database,
  experienceId: string,
  verifierPubkey: string,
  result: VerificationResult,
): boolean {
  const exp = getExperienceForPulse(db, experienceId)
  if (!exp) return false

  // 同 operator 不触发（连 event 都不记录）
  if (exp.operator_pubkey === verifierPubkey) return false

  const isConfirmed = result === 'confirmed'
  const currentLevel = STATE_LEVEL[exp.pulse_state]
  const targetLevel = STATE_LEVEL['verified']
  const stateChanged = isConfirmed && currentLevel < targetLevel

  const newState: PulseState = stateChanged ? 'verified' : exp.pulse_state

  if (stateChanged) {
    updateState(db, experienceId, newState)
  }

  const context = isConfirmed
    ? stateChanged
      ? `经验被 ${verifierPubkey.slice(0, 8)}... 验证确认，状态从 ${exp.pulse_state} 提升到 verified`
      : `经验被 ${verifierPubkey.slice(0, 8)}... 验证确认（状态保持 ${exp.pulse_state}）`
    : `经验被 ${verifierPubkey.slice(0, 8)}... 验证否定（denied），状态不变`

  recordPulseEvent(db, experienceId, 'verification', exp.pulse_state, newState, verifierPubkey, context)

  return stateChanged
}

/**
 * 引用触发：→ propagating
 * - 同 operator 引用不触发
 * - 已经 propagating 时不变状态
 * @returns true 如果状态发生了变化
 */
export function transitionOnCite(
  db: Database.Database,
  experienceId: string,
  citerPubkey: string,
): boolean {
  const exp = getExperienceForPulse(db, experienceId)
  if (!exp) return false

  // 同 operator 不触发
  if (exp.operator_pubkey === citerPubkey) return false

  const currentLevel = STATE_LEVEL[exp.pulse_state]
  const targetLevel = STATE_LEVEL['propagating']
  const stateChanged = currentLevel < targetLevel

  const newState: PulseState = stateChanged ? 'propagating' : exp.pulse_state

  if (stateChanged) {
    updateState(db, experienceId, newState)
  }

  const context = stateChanged
    ? `经验被 ${citerPubkey.slice(0, 8)}... 引用，状态从 ${exp.pulse_state} 提升到 propagating`
    : `经验被 ${citerPubkey.slice(0, 8)}... 引用（状态保持 propagating）`

  recordPulseEvent(db, experienceId, 'citation', exp.pulse_state, newState, citerPubkey, context)

  return stateChanged
}

// ─── 查询函数 ───

/**
 * 获取经验当前 pulse 状态
 */
export function getPulseState(db: Database.Database, experienceId: string): PulseState | null {
  const row = db
    .prepare('SELECT pulse_state FROM experiences WHERE id = ?')
    .get(experienceId) as { pulse_state: PulseState } | undefined
  return row?.pulse_state ?? null
}

/**
 * 获取某条经验的 pulse events
 * @param since 可选，只返回该时间戳之后的事件
 */
export function getPulseEvents(
  db: Database.Database,
  experienceId: string,
  since?: number,
): PulseEvent[] {
  if (since !== undefined) {
    const rows = db
      .prepare('SELECT * FROM pulse_events WHERE experience_id = ? AND created_at > ? ORDER BY created_at ASC')
      .all(experienceId, since) as Record<string, unknown>[]
    return rows.map(rowToPulseEvent)
  }

  const rows = db
    .prepare('SELECT * FROM pulse_events WHERE experience_id = ? ORDER BY created_at ASC')
    .all(experienceId) as Record<string, unknown>[]
  return rows.map(rowToPulseEvent)
}

/**
 * 按 operator pubkey 获取其所有经验的 pulse events
 * 关联 experiences 表查 operator_pubkey
 */
export function getPulseEventsByOperator(
  db: Database.Database,
  operatorPubkey: string,
  since?: number,
): PulseEvent[] {
  const baseSql = `
    SELECT pe.* FROM pulse_events pe
    JOIN experiences e ON pe.experience_id = e.id
    WHERE e.operator_pubkey = ?
  `
  if (since !== undefined) {
    const rows = db
      .prepare(`${baseSql} AND pe.created_at > ? ORDER BY pe.created_at ASC`)
      .all(operatorPubkey, since) as Record<string, unknown>[]
    return rows.map(rowToPulseEvent)
  }

  const rows = db
    .prepare(`${baseSql} ORDER BY pe.created_at ASC`)
    .all(operatorPubkey) as Record<string, unknown>[]
  return rows.map(rowToPulseEvent)
}

// ─── 内部行转换 ───

function rowToPulseEvent(row: Record<string, unknown>): PulseEvent {
  return {
    id: row.id as number,
    experience_id: row.experience_id as string,
    event_type: row.event_type as PulseEventType,
    from_state: row.from_state as PulseState,
    to_state: row.to_state as PulseState,
    actor_pubkey: row.actor_pubkey as string,
    context: row.context as string,
    created_at: row.created_at as number,
  }
}
