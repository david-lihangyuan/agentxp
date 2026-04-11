/**
 * g1-node-registry.test.ts — Phase 2G / G1
 * 节点注册与发现系统的测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  initNodeRegistry,
  registerNode,
  heartbeatNode,
  getActiveNodes,
  getAllNodes,
  getNode,
  pruneOldNodes,
  NODE_HEARTBEAT_TTL_MS,
} from '../src/node-registry.js'
import Database from 'better-sqlite3'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initNodeRegistry(db)
  return db
}

const MOCK_NODE = {
  nodeId: 'node-abc123',
  url: 'wss://node1.example.com',
  pubkey: 'pubkey-operator-001',
  version: '0.1.0',
  capabilities: ['experience', 'identity'],
}

describe('G1 - 节点注册与发现', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  // ── 基础注册 ──────────────────────────────────────────────────

  it('注册新节点并返回 NodeRecord', () => {
    const now = Date.now()
    const node = registerNode(db, MOCK_NODE, now)

    expect(node.nodeId).toBe(MOCK_NODE.nodeId)
    expect(node.url).toBe(MOCK_NODE.url)
    expect(node.pubkey).toBe(MOCK_NODE.pubkey)
    expect(node.version).toBe('0.1.0')
    expect(node.capabilities).toEqual(['experience', 'identity'])
    expect(node.registeredAt).toBe(now)
    expect(node.lastSeenAt).toBe(now)
  })

  it('重复注册同一 nodeId — 更新 URL/版本，保留 registeredAt', () => {
    const t1 = 1000
    const t2 = 2000
    registerNode(db, MOCK_NODE, t1)

    const updated = registerNode(db, {
      ...MOCK_NODE,
      url: 'wss://node1-new.example.com',
      version: '0.2.0',
    }, t2)

    expect(updated.registeredAt).toBe(t1)  // 保留首次注册时间
    expect(updated.lastSeenAt).toBe(t2)
    expect(updated.url).toBe('wss://node1-new.example.com')
    expect(updated.version).toBe('0.2.0')
  })

  it('默认 version=0.1.0 / capabilities=[]', () => {
    const node = registerNode(db, {
      nodeId: 'bare-node',
      url: 'https://bare.example.com',
      pubkey: 'pub-bare',
    })
    expect(node.version).toBe('0.1.0')
    expect(node.capabilities).toEqual([])
  })

  it('支持 http/https/ws/wss URL', () => {
    const urls = [
      'wss://node.example.com',
      'ws://node.local:4000',
      'https://node.example.com',
      'http://127.0.0.1:3000',
    ]
    for (const url of urls) {
      expect(() => registerNode(db, { ...MOCK_NODE, nodeId: url, url })).not.toThrow()
    }
  })

  it('缺少必填字段抛错', () => {
    expect(() => registerNode(db, { nodeId: '', url: 'wss://x.com', pubkey: 'pk' })).toThrow()
    expect(() => registerNode(db, { nodeId: 'id', url: '', pubkey: 'pk' })).toThrow()
    expect(() => registerNode(db, { nodeId: 'id', url: 'wss://x.com', pubkey: '' })).toThrow()
  })

  // ── 心跳 ──────────────────────────────────────────────────────

  it('心跳更新 last_seen_at', () => {
    const t1 = 1000
    const t2 = 5000
    registerNode(db, MOCK_NODE, t1)

    const ok = heartbeatNode(db, MOCK_NODE.nodeId, t2)
    expect(ok).toBe(true)

    const node = getNode(db, MOCK_NODE.nodeId)
    expect(node?.lastSeenAt).toBe(t2)
    expect(node?.registeredAt).toBe(t1) // 注册时间不变
  })

  it('对不存在的 nodeId 心跳返回 false', () => {
    const ok = heartbeatNode(db, 'nonexistent-node', Date.now())
    expect(ok).toBe(false)
  })

  // ── 活跃节点发现 ─────────────────────────────────────────────

  it('getActiveNodes 只返回 TTL 内的节点', () => {
    const now = 100_000
    registerNode(db, { ...MOCK_NODE, nodeId: 'active-1' }, now - 1000)  // 1秒前 → 活跃
    registerNode(db, { ...MOCK_NODE, nodeId: 'active-2' }, now - (NODE_HEARTBEAT_TTL_MS - 100)) // 刚好在内 → 活跃
    registerNode(db, { ...MOCK_NODE, nodeId: 'stale-1' }, now - (NODE_HEARTBEAT_TTL_MS + 1000)) // 超时 → 不活跃

    const active = getActiveNodes(db, now)
    const ids = active.map(n => n.nodeId)
    expect(ids).toContain('active-1')
    expect(ids).toContain('active-2')
    expect(ids).not.toContain('stale-1')
  })

  it('getActiveNodes 按 last_seen_at 降序排列', () => {
    const now = 200_000
    registerNode(db, { ...MOCK_NODE, nodeId: 'n1' }, now - 3000)
    registerNode(db, { ...MOCK_NODE, nodeId: 'n2' }, now - 1000)
    registerNode(db, { ...MOCK_NODE, nodeId: 'n3' }, now - 2000)

    const active = getActiveNodes(db, now)
    expect(active[0].nodeId).toBe('n2')  // 最新的在前
  })

  it('没有节点时返回空数组', () => {
    expect(getActiveNodes(db)).toEqual([])
  })

  // ── 全部节点查询 ─────────────────────────────────────────────

  it('getAllNodes 包含不活跃节点', () => {
    const now = 100_000
    registerNode(db, { ...MOCK_NODE, nodeId: 'old-node' }, 0)  // 超过 TTL
    registerNode(db, { ...MOCK_NODE, nodeId: 'new-node' }, now)

    const all = getAllNodes(db)
    expect(all.length).toBe(2)
  })

  // ── 单节点查询 ────────────────────────────────────────────────

  it('getNode 返回正确节点', () => {
    registerNode(db, MOCK_NODE, 12345)
    const node = getNode(db, MOCK_NODE.nodeId)
    expect(node?.nodeId).toBe(MOCK_NODE.nodeId)
    expect(node?.capabilities).toEqual(['experience', 'identity'])
  })

  it('getNode 找不到返回 null', () => {
    expect(getNode(db, 'ghost')).toBeNull()
  })

  // ── 清理过期节点 ──────────────────────────────────────────────

  it('pruneOldNodes 删除过老的节点', () => {
    const now = 1_000_000
    const maxAge = 10 * 60 * 1000 // 10 分钟
    registerNode(db, { ...MOCK_NODE, nodeId: 'old' }, now - maxAge - 1000)   // 超过 maxAge
    registerNode(db, { ...MOCK_NODE, nodeId: 'recent' }, now - maxAge + 1000) // 没超过

    const pruned = pruneOldNodes(db, maxAge, now)
    expect(pruned).toBe(1)

    const all = getAllNodes(db)
    expect(all.length).toBe(1)
    expect(all[0].nodeId).toBe('recent')
  })

  it('pruneOldNodes 没有符合条件时返回 0', () => {
    registerNode(db, MOCK_NODE, Date.now())
    const pruned = pruneOldNodes(db, 1000, Date.now() + 500) // TTL 比注册时间更短
    // 节点是刚注册的，不应该被删
    expect(pruned).toBe(0)
  })

  // ── 多节点并发 ────────────────────────────────────────────────

  it('可以注册多个不同 nodeId 的节点', () => {
    const count = 5
    for (let i = 0; i < count; i++) {
      registerNode(db, { ...MOCK_NODE, nodeId: `node-${i}`, url: `wss://node${i}.example.com` })
    }
    expect(getAllNodes(db).length).toBe(count)
  })
})
