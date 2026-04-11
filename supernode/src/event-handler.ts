/**
 * 事件接收与验证
 * B3: 接收 SerendipEvent → 验签 → 存储 / 拒绝
 */
import { verifyEvent } from '@serendip/protocol'
import type { SerendipEvent } from '@serendip/protocol'
import type Database from 'better-sqlite3'

export interface HandleResult {
  ok: boolean
  error?: string
  eventId?: string
}

/**
 * 将已验证的事件存入数据库
 */
function storeEvent(db: Database.Database, event: SerendipEvent): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO events (id, kind, pubkey, created_at, content, tags, sig, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    event.id,
    event.kind,
    event.pubkey,
    event.created_at,
    JSON.stringify(event.content),
    JSON.stringify(event.tags ?? []),
    event.sig,
    JSON.stringify(event),
  )
}

/**
 * 从数据库取单个事件
 */
export function getEvent(db: Database.Database, id: string): SerendipEvent | null {
  const row = db.prepare('SELECT raw FROM events WHERE id = ?').get(id) as
    | { raw: string }
    | undefined
  if (!row) return null
  return JSON.parse(row.raw) as SerendipEvent
}

/**
 * 核心处理函数：接收并验证一个事件
 */
export async function handleEvent(
  db: Database.Database,
  event: unknown,
): Promise<HandleResult> {
  // 基础类型检查
  if (!event || typeof event !== 'object') {
    return { ok: false, error: 'Invalid event: not an object' }
  }

  const e = event as Record<string, unknown>

  // 必填字段检查
  const required = ['id', 'kind', 'pubkey', 'created_at', 'content', 'sig']
  for (const field of required) {
    if (e[field] === undefined || e[field] === null) {
      return { ok: false, error: `Invalid event: missing field '${field}'` }
    }
  }

  // 类型检查
  if (typeof e.id !== 'string' || e.id.length !== 64) {
    return { ok: false, error: 'Invalid event: id must be 64-char hex string' }
  }
  if (typeof e.kind !== 'string') {
    return { ok: false, error: 'Invalid event: kind must be a string' }
  }
  if (typeof e.pubkey !== 'string' || e.pubkey.length !== 64) {
    return { ok: false, error: 'Invalid event: pubkey must be 64-char hex string' }
  }
  if (typeof e.created_at !== 'number') {
    return { ok: false, error: 'Invalid event: created_at must be a number' }
  }
  if (typeof e.sig !== 'string' || e.sig.length !== 128) {
    return { ok: false, error: 'Invalid event: sig must be 128-char hex string' }
  }

  const typedEvent = event as SerendipEvent

  // 验证签名（密码学验证）
  let valid: boolean
  try {
    valid = await verifyEvent(typedEvent)
  } catch (err) {
    return { ok: false, error: `Signature verification failed: ${String(err)}` }
  }

  if (!valid) {
    return { ok: false, error: 'Invalid event: signature verification failed' }
  }

  // 存储
  try {
    storeEvent(db, typedEvent)
  } catch (err) {
    return { ok: false, error: `Storage failed: ${String(err)}` }
  }

  return { ok: true, eventId: typedEvent.id }
}

/**
 * 从 JSON 字符串解析并处理事件（用于 WebSocket 消息处理）
 */
export async function handleRawMessage(
  db: Database.Database,
  raw: string,
): Promise<HandleResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }

  // 如果是 pong 消息，直接忽略（由 connection pool 处理）
  if (typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>).type === 'pong') {
    return { ok: true, eventId: undefined }
  }

  return handleEvent(db, parsed)
}
