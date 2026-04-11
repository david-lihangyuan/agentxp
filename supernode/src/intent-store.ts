/**
 * 意图广播处理与存储
 * B4: intent.broadcast 事件 → 存入 intents 表 → 按 payload.type 路由到应用层
 *
 * 协议核心层：不理解 payload.data 的具体结构，只关心 payload.type 做路由。
 * embedding 基于 payload.summary（如果有）或 payload.type + tags 做语义索引。
 */
import type Database from 'better-sqlite3'
import type { SerendipEvent, IntentPayload } from '@serendip/protocol'

// ============================================================
// Types
// ============================================================

export interface StoredIntent {
  id: string              // = event.id
  event_id: string        // 原始事件 ID
  pubkey: string          // 发布者公钥
  operator_pubkey?: string
  payload_type: string    // = content.type（协议层用于路由）
  summary?: string        // = content.summary（协议层用于 embedding）
  tags: string[]          // = content.tags + event.tags（合并）
  data_json: string       // = JSON.stringify(content.data)（协议层不解析）
  embedding?: number[]    // 基于 summary 的语义向量
  created_at: number
  updated_at: number
}

export interface IntentStoreResult {
  ok: boolean
  error?: string
  intentId?: string
  payload_type?: string
}

// 应用层处理器：收到 intent.broadcast 事件后按 payload.type 路由
export type IntentHandler = (
  db: Database.Database,
  event: SerendipEvent,
  payload: IntentPayload,
) => IntentStoreResult | Promise<IntentStoreResult>

// ============================================================
// Schema
// ============================================================

export function initIntentsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      pubkey TEXT NOT NULL,
      operator_pubkey TEXT,
      payload_type TEXT NOT NULL,
      summary TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      data_json TEXT NOT NULL DEFAULT '{}',
      embedding TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_intent_pubkey ON intents(pubkey);
    CREATE INDEX IF NOT EXISTS idx_intent_type ON intents(payload_type);
    CREATE INDEX IF NOT EXISTS idx_intent_created ON intents(created_at);
  `)
}

// ============================================================
// 应用层路由注册
// ============================================================

const handlers = new Map<string, IntentHandler>()

/**
 * 注册应用层处理器
 * 当 intent.broadcast 的 payload.type 匹配时调用
 *
 * 用法示例：
 *   registerIntentHandler('experience', agentxpHandler)
 *   registerIntentHandler('commerce.supply', commerceHandler)
 */
export function registerIntentHandler(payloadType: string, handler: IntentHandler): void {
  handlers.set(payloadType, handler)
}

/**
 * 清除所有注册的处理器（测试用）
 */
export function clearIntentHandlers(): void {
  handlers.clear()
}

// ============================================================
// 核心：处理 intent.broadcast 事件
// ============================================================

/**
 * 处理 intent.broadcast 事件
 *
 * 1. 验证 kind 是 intent.broadcast
 * 2. 解析 payload（content 即 IntentPayload）
 * 3. 存入通用 intents 表
 * 4. 如果有注册的应用层处理器，调用它
 */
export async function processIntentBroadcast(
  db: Database.Database,
  event: SerendipEvent,
): Promise<IntentStoreResult> {
  // 只处理 intent.broadcast
  if (event.kind !== 'intent.broadcast') {
    return { ok: false, error: `Expected 'intent.broadcast', got '${event.kind}'` }
  }

  // 解析 payload
  const payload = event.content as IntentPayload
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Invalid content: must be an object' }
  }
  if (typeof payload.type !== 'string' || payload.type.trim() === '') {
    return { ok: false, error: 'Invalid content: type is required' }
  }

  const payloadType = payload.type.trim()
  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : undefined
  const payloadTags = Array.isArray(payload.tags)
    ? payload.tags.filter((t): t is string => typeof t === 'string')
    : []
  const eventTags = Array.isArray(event.tags)
    ? event.tags.filter((t): t is string => typeof t === 'string')
    : []
  // 合并 event.tags 和 payload.tags，去重
  const allTags = [...new Set([...eventTags, ...payloadTags])]

  const intentId = event.id
  const now = Date.now()

  // 存入通用 intents 表
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO intents
        (id, event_id, pubkey, operator_pubkey, payload_type, summary, tags, data_json,
         embedding, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `)
    stmt.run(
      intentId,
      event.id,
      event.pubkey,
      event.operator_pubkey ?? null,
      payloadType,
      summary ?? null,
      JSON.stringify(allTags),
      JSON.stringify(payload.data ?? {}),
      event.created_at,
      now,
    )
  } catch (err) {
    return { ok: false, error: `Storage failed: ${String(err)}` }
  }

  // 调用应用层处理器（如果注册了）
  const handler = handlers.get(payloadType)
  if (handler) {
    try {
      const appResult = await handler(db, event, payload)
      // 应用层失败不影响协议层存储（已存入 intents 表）
      // 但返回应用层的错误信息
      if (!appResult.ok) {
        return { ok: true, intentId, payload_type: payloadType, error: `App handler error: ${appResult.error}` }
      }
    } catch (err) {
      // 应用层崩溃不影响协议层
      return { ok: true, intentId, payload_type: payloadType, error: `App handler crashed: ${String(err)}` }
    }
  }

  return { ok: true, intentId, payload_type: payloadType }
}

// ============================================================
// 查询
// ============================================================

function rowToIntent(row: Record<string, unknown>): StoredIntent {
  return {
    id: row.id as string,
    event_id: row.event_id as string,
    pubkey: row.pubkey as string,
    operator_pubkey: row.operator_pubkey as string | undefined,
    payload_type: row.payload_type as string,
    summary: row.summary as string | undefined,
    tags: JSON.parse((row.tags as string) || '[]'),
    data_json: row.data_json as string,
    embedding: row.embedding ? JSON.parse(row.embedding as string) : undefined,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  }
}

export function getIntent(db: Database.Database, id: string): StoredIntent | null {
  const row = db.prepare('SELECT * FROM intents WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToIntent(row)
}

export function listIntentsByType(
  db: Database.Database,
  payloadType: string,
  limit = 50,
  offset = 0,
): StoredIntent[] {
  const rows = db
    .prepare('SELECT * FROM intents WHERE payload_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(payloadType, limit, offset) as Record<string, unknown>[]
  return rows.map(rowToIntent)
}

export function listIntentsByPubkey(
  db: Database.Database,
  pubkey: string,
  limit = 50,
  offset = 0,
): StoredIntent[] {
  const rows = db
    .prepare('SELECT * FROM intents WHERE pubkey = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(pubkey, limit, offset) as Record<string, unknown>[]
  return rows.map(rowToIntent)
}

export function updateIntentEmbedding(
  db: Database.Database,
  id: string,
  embedding: number[],
): boolean {
  const info = db
    .prepare('UPDATE intents SET embedding = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(embedding), Date.now(), id)
  return info.changes > 0
}

export function countIntents(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM intents').get() as { cnt: number }
  return row.cnt
}
