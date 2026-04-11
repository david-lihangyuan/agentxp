/**
 * experience-sync.ts — Phase 2G / G2
 * 超级节点间经验同步
 *
 * 设计原则：
 * - 同步是拉取模型（pull-based），不是推送
 * - 每条同步的经验必须通过签名验证，拒绝伪造内容
 * - 同步是幂等的：重复同步同一条经验不报错
 * - 定时同步通过可注入的调度器实现（测试友好）
 */

import type Database from 'better-sqlite3'
import { verifyEvent } from '@serendip/protocol'
import type { SerendipEvent } from '@serendip/protocol'
import { publishExperience } from './experience-store.js'

export interface SyncRecord {
  syncId: string        // 唯一 ID（uuid）
  sourceNodeId: string  // 来源节点
  eventId: string       // 被同步的事件 ID
  syncedAt: number      // 同步时间戳（ms）
  status: 'ok' | 'rejected' | 'duplicate'
  reason?: string       // 拒绝时的原因
}

export interface SyncResult {
  imported: number
  rejected: number
  duplicates: number
  details: SyncRecord[]
}

export interface SyncFetchResult {
  events: SerendipEvent[]
  nextSince?: number
}

/** 初始化同步记录表 */
export function initSyncSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      sync_id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ok', 'rejected', 'duplicate')),
      reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_log_event ON sync_log(event_id);
    CREATE INDEX IF NOT EXISTS idx_sync_log_source ON sync_log(source_node_id);
    CREATE INDEX IF NOT EXISTS idx_sync_log_synced_at ON sync_log(synced_at);
  `)
}

/**
 * 从远程节点同步经验
 * @param db - 本地数据库
 * @param sourceNodeId - 来源节点 ID
 * @param events - 远程拉取到的事件列表（已由调用方 fetch）
 * @param now - 当前时间戳（可注入用于测试）
 */
export async function syncExperiences(
  db: Database.Database,
  sourceNodeId: string,
  events: SerendipEvent[],
  now: number = Date.now()
): Promise<SyncResult> {
  const result: SyncResult = {
    imported: 0,
    rejected: 0,
    duplicates: 0,
    details: [],
  }

  for (const event of events) {
    const syncId = generateSyncId()

    // 检查是否已同步过
    const existing = db.prepare(
      "SELECT sync_id FROM sync_log WHERE event_id = ? AND status = 'ok'"
    ).get(event.id) as { sync_id: string } | undefined

    if (existing) {
      result.duplicates++
      result.details.push({
        syncId,
        sourceNodeId,
        eventId: event.id,
        syncedAt: now,
        status: 'duplicate',
        reason: 'already synced',
      })
      db.prepare(`
        INSERT INTO sync_log (sync_id, source_node_id, event_id, synced_at, status, reason)
        VALUES (?, ?, ?, ?, 'duplicate', 'already synced')
      `).run(syncId, sourceNodeId, event.id, now)
      continue
    }

    // 签名验证（verifyEvent 是 async）
    let sigValid = false
    try {
      sigValid = await verifyEvent(event)
    } catch {
      sigValid = false
    }

    if (!sigValid) {
      result.rejected++
      result.details.push({
        syncId,
        sourceNodeId,
        eventId: event.id,
        syncedAt: now,
        status: 'rejected',
        reason: 'invalid signature',
      })
      db.prepare(`
        INSERT INTO sync_log (sync_id, source_node_id, event_id, synced_at, status, reason)
        VALUES (?, ?, ?, ?, 'rejected', 'invalid signature')
      `).run(syncId, sourceNodeId, event.id, now)
      continue
    }

    // 只同步 intent.broadcast 类型
    if (event.kind !== 'intent.broadcast') {
      result.rejected++
      const reason = `unsupported kind: ${event.kind}`
      result.details.push({
        syncId,
        sourceNodeId,
        eventId: event.id,
        syncedAt: now,
        status: 'rejected',
        reason,
      })
      db.prepare(`
        INSERT INTO sync_log (sync_id, source_node_id, event_id, synced_at, status, reason)
        VALUES (?, ?, ?, ?, 'rejected', ?)
      `).run(syncId, sourceNodeId, event.id, now, reason)
      continue
    }

    // 写入本地数据库（幂等）
    try {
      // 先存原始事件到 events 表（协议层统一存储）
      db.prepare(`
        INSERT OR IGNORE INTO events (id, kind, pubkey, created_at, content, tags, sig, raw)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.kind,
        event.pubkey,
        event.created_at,
        JSON.stringify(event.content),
        JSON.stringify(event.tags ?? []),
        event.sig,
        JSON.stringify(event),
      )
      // 再解析应用层内容存到 experiences 表
      publishExperience(db, event)
      result.imported++
      result.details.push({
        syncId,
        sourceNodeId,
        eventId: event.id,
        syncedAt: now,
        status: 'ok',
      })
      db.prepare(`
        INSERT INTO sync_log (sync_id, source_node_id, event_id, synced_at, status)
        VALUES (?, ?, ?, ?, 'ok')
      `).run(syncId, sourceNodeId, event.id, now)
    } catch (err) {
      result.rejected++
      const reason = err instanceof Error ? err.message : 'unknown error'
      result.details.push({
        syncId,
        sourceNodeId,
        eventId: event.id,
        syncedAt: now,
        status: 'rejected',
        reason,
      })
      db.prepare(`
        INSERT INTO sync_log (sync_id, source_node_id, event_id, synced_at, status, reason)
        VALUES (?, ?, ?, ?, 'rejected', ?)
      `).run(syncId, sourceNodeId, event.id, now, reason)
    }
  }

  return result
}

/** 获取本地事件（供其他节点同步，按 created_at 过滤） */
export function getExperiencesForSync(
  db: Database.Database,
  since: number = 0,
  limit: number = 100
): { events: Array<{ id: string; kind: string; pubkey: string; content: string; tags: string; created_at: number; sig: string }>; total: number; has_more: boolean } {
  // 从 v3 events 表查询（协议层统一存储）
  const rows = db.prepare(`
    SELECT id, kind, pubkey, content, tags, created_at, sig
    FROM events
    WHERE created_at > ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(since, limit) as Array<{
    id: string
    kind: string
    pubkey: string
    content: string
    tags: string
    created_at: number
    sig: string
  }>

  const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE created_at > ?`).get(since) as { cnt: number }

  return {
    events: rows,
    total: totalRow.cnt,
    has_more: totalRow.cnt > rows.length,
  }
}

/** 获取同步记录（用于审计和调试） */
export function getSyncLog(
  db: Database.Database,
  options: { sourceNodeId?: string; status?: string; limit?: number } = {}
): SyncRecord[] {
  const { sourceNodeId, status, limit = 50 } = options
  let query = 'SELECT * FROM sync_log WHERE 1=1'
  const params: (string | number)[] = []

  if (sourceNodeId) {
    query += ' AND source_node_id = ?'
    params.push(sourceNodeId)
  }
  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }
  query += ' ORDER BY synced_at DESC LIMIT ?'
  params.push(limit)

  const rows = db.prepare(query).all(...params) as Array<{
    sync_id: string
    source_node_id: string
    event_id: string
    synced_at: number
    status: string
    reason: string | null
  }>

  return rows.map(row => ({
    syncId: row.sync_id,
    sourceNodeId: row.source_node_id,
    eventId: row.event_id,
    syncedAt: row.synced_at,
    status: row.status as SyncRecord['status'],
    reason: row.reason ?? undefined,
  }))
}

/** 获取同步统计（按来源节点汇总） */
export function getSyncStats(
  db: Database.Database
): Array<{ sourceNodeId: string; total: number; ok: number; rejected: number; duplicates: number }> {
  const rows = db.prepare(`
    SELECT
      source_node_id,
      COUNT(*) as total,
      SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as ok_count,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected_count,
      SUM(CASE WHEN status='duplicate' THEN 1 ELSE 0 END) as duplicate_count
    FROM sync_log
    GROUP BY source_node_id
    ORDER BY total DESC
  `).all() as Array<{
    source_node_id: string
    total: number
    ok_count: number
    rejected_count: number
    duplicate_count: number
  }>

  return rows.map(r => ({
    sourceNodeId: r.source_node_id,
    total: r.total,
    ok: r.ok_count,
    rejected: r.rejected_count,
    duplicates: r.duplicate_count,
  }))
}

// ── 工具 ─────────────────────────────────────────────────────────

function generateSyncId(): string {
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
