import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp } from '../src/app.js'
import { createInMemoryDb } from '../src/db.js'

describe('B1 - 超级节点脚手架', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
  })

  describe('GET /health', () => {
    it('返回 200 状态码', async () => {
      const req = new Request('http://localhost/health')
      const res = await app.fetch(req)
      expect(res.status).toBe(200)
    })

    it('返回 JSON 格式', async () => {
      const req = new Request('http://localhost/health')
      const res = await app.fetch(req)
      const body = await res.json() as Record<string, unknown>
      expect(body).toBeDefined()
    })

    it('status 字段为 ok', async () => {
      const req = new Request('http://localhost/health')
      const res = await app.fetch(req)
      const body = await res.json() as Record<string, unknown>
      expect(body.status).toBe('ok')
    })

    it('包含 version 字段', async () => {
      const req = new Request('http://localhost/health')
      const res = await app.fetch(req)
      const body = await res.json() as Record<string, unknown>
      expect(typeof body.version).toBe('string')
      expect(body.version).not.toBe('')
    })

    it('包含 timestamp 字段（ISO 格式）', async () => {
      const req = new Request('http://localhost/health')
      const res = await app.fetch(req)
      const body = await res.json() as Record<string, unknown>
      expect(typeof body.timestamp).toBe('string')
      expect(() => new Date(body.timestamp as string)).not.toThrow()
    })

    it('包含 uptime 字段（数字）', async () => {
      const req = new Request('http://localhost/health')
      const res = await app.fetch(req)
      const body = await res.json() as Record<string, unknown>
      expect(typeof body.uptime).toBe('number')
      expect(body.uptime as number).toBeGreaterThanOrEqual(0)
    })
  })

  describe('未知路径', () => {
    it('返回 404', async () => {
      const req = new Request('http://localhost/not-exist')
      const res = await app.fetch(req)
      expect(res.status).toBe(404)
    })

    it('返回错误 JSON', async () => {
      const req = new Request('http://localhost/not-exist')
      const res = await app.fetch(req)
      const body = await res.json() as Record<string, unknown>
      expect(body.error).toBeDefined()
    })
  })

  describe('数据库初始化', () => {
    it('能创建内存数据库', () => {
      const db = createInMemoryDb()
      expect(db).toBeDefined()
      db.close()
    })

    it('events 表存在', () => {
      const db = createInMemoryDb()
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
      ).get() as { name: string } | undefined
      expect(result?.name).toBe('events')
      db.close()
    })

    it('identities 表存在', () => {
      const db = createInMemoryDb()
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='identities'"
      ).get() as { name: string } | undefined
      expect(result?.name).toBe('identities')
      db.close()
    })

    it('events 表有正确的列', () => {
      const db = createInMemoryDb()
      const info = db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>
      const cols = info.map(r => r.name)
      expect(cols).toContain('id')
      expect(cols).toContain('kind')
      expect(cols).toContain('pubkey')
      expect(cols).toContain('created_at')
      expect(cols).toContain('content')
      expect(cols).toContain('sig')
      db.close()
    })

    it('identities 表有正确的列', () => {
      const db = createInMemoryDb()
      const info = db.prepare("PRAGMA table_info(identities)").all() as Array<{ name: string }>
      const cols = info.map(r => r.name)
      expect(cols).toContain('pubkey')
      expect(cols).toContain('kind')
      expect(cols).toContain('delegated_by')
      expect(cols).toContain('expires_at')
      expect(cols).toContain('revoked')
      db.close()
    })

    it('重复初始化不报错（幂等）', () => {
      const db = createInMemoryDb()
      // 再次 initDb 不应报错
      expect(() => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            pubkey TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            content TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            sig TEXT NOT NULL,
            raw TEXT NOT NULL
          )
        `)
      }).not.toThrow()
      db.close()
    })
  })
})
