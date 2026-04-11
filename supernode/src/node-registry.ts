/**
 * node-registry.ts — Phase 2G / G1
 * 超级节点注册与发现
 *
 * 设计原则：
 * - 节点是协议参与者，不是中心化服务的客户端
 * - 注册 = 自我声明，发现 = 拉取列表，心跳 = 持续存活证明
 * - 节点死亡由 TTL 决定，不依赖主动注销
 */

import type Database from 'better-sqlite3'

export const NODE_HEARTBEAT_TTL_MS = 5 * 60 * 1000 // 5 分钟内没心跳 = 不活跃

export interface NodeRecord {
  nodeId: string        // 全局唯一 ID（节点公钥或自定义 ID）
  url: string           // 节点 WebSocket/HTTP 可达地址
  pubkey: string        // 节点运营者公钥
  version: string       // 协议版本
  capabilities: string[] // 支持的能力（如 experience, identity）
  registeredAt: number  // 首次注册时间戳（ms）
  lastSeenAt: number    // 最近一次心跳时间戳（ms）
}

export interface RegisterNodeParams {
  nodeId: string
  url: string
  pubkey: string
  version?: string
  capabilities?: string[]
}

/** 初始化节点注册表（nodes 表）*/
export function initNodeRegistry(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      node_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      pubkey TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '0.1.0',
      capabilities TEXT NOT NULL DEFAULT '[]',
      registered_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_nodes_pubkey ON nodes(pubkey);
  `)
}

/** 注册或更新节点（幂等：nodeId 相同则更新 url/version/capabilities/last_seen_at） */
export function registerNode(
  db: Database.Database,
  params: RegisterNodeParams,
  now: number = Date.now()
): NodeRecord {
  const { nodeId, url, pubkey, version = '0.1.0', capabilities = [] } = params

  if (!nodeId || !url || !pubkey) {
    throw new Error('nodeId, url, pubkey are required')
  }

  // 验证 URL 格式（ws/wss/http/https）
  if (!isValidUrl(url)) {
    throw new Error(`Invalid URL format: ${url}`)
  }

  const capsJson = JSON.stringify(capabilities)
  const existing = db.prepare('SELECT registered_at FROM nodes WHERE node_id = ?').get(nodeId) as
    | { registered_at: number }
    | undefined

  const registeredAt = existing ? existing.registered_at : now

  db.prepare(`
    INSERT INTO nodes (node_id, url, pubkey, version, capabilities, registered_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
      url = excluded.url,
      pubkey = excluded.pubkey,
      version = excluded.version,
      capabilities = excluded.capabilities,
      last_seen_at = excluded.last_seen_at
  `).run(nodeId, url, pubkey, version, capsJson, registeredAt, now)

  return {
    nodeId,
    url,
    pubkey,
    version,
    capabilities,
    registeredAt,
    lastSeenAt: now,
  }
}

/** 节点心跳：更新 last_seen_at */
export function heartbeatNode(
  db: Database.Database,
  nodeId: string,
  now: number = Date.now()
): boolean {
  const result = db.prepare(
    'UPDATE nodes SET last_seen_at = ? WHERE node_id = ?'
  ).run(now, nodeId)
  return result.changes > 0
}

/** 获取活跃节点列表（last_seen_at 在 TTL 内） */
export function getActiveNodes(
  db: Database.Database,
  now: number = Date.now(),
  ttlMs: number = NODE_HEARTBEAT_TTL_MS
): NodeRecord[] {
  const cutoff = now - ttlMs
  const rows = db.prepare(
    'SELECT * FROM nodes WHERE last_seen_at >= ? ORDER BY last_seen_at DESC'
  ).all(cutoff) as Array<{
    node_id: string
    url: string
    pubkey: string
    version: string
    capabilities: string
    registered_at: number
    last_seen_at: number
  }>

  return rows.map(toNodeRecord)
}

/** 获取所有节点（含不活跃） */
export function getAllNodes(db: Database.Database): NodeRecord[] {
  const rows = db.prepare(
    'SELECT * FROM nodes ORDER BY last_seen_at DESC'
  ).all() as Array<{
    node_id: string
    url: string
    pubkey: string
    version: string
    capabilities: string
    registered_at: number
    last_seen_at: number
  }>
  return rows.map(toNodeRecord)
}

/** 获取单个节点 */
export function getNode(db: Database.Database, nodeId: string): NodeRecord | null {
  const row = db.prepare('SELECT * FROM nodes WHERE node_id = ?').get(nodeId) as
    | {
        node_id: string
        url: string
        pubkey: string
        version: string
        capabilities: string
        registered_at: number
        last_seen_at: number
      }
    | undefined
  return row ? toNodeRecord(row) : null
}

/** 清理过期节点（超过 maxAge 的节点） */
export function pruneOldNodes(
  db: Database.Database,
  maxAgeMs: number,
  now: number = Date.now()
): number {
  const cutoff = now - maxAgeMs
  const result = db.prepare('DELETE FROM nodes WHERE last_seen_at < ?').run(cutoff)
  return result.changes
}

// ── 内部工具 ──────────────────────────────────────────────────────

function toNodeRecord(row: {
  node_id: string
  url: string
  pubkey: string
  version: string
  capabilities: string
  registered_at: number
  last_seen_at: number
}): NodeRecord {
  return {
    nodeId: row.node_id,
    url: row.url,
    pubkey: row.pubkey,
    version: row.version,
    capabilities: JSON.parse(row.capabilities) as string[],
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}
