import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb } from '../src/db.js'
import { handleEvent, handleRawMessage, getEvent } from '../src/event-handler.js'
import { createApp } from '../src/app.js'
import {
  generateOperatorKey,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import type Database from 'better-sqlite3'

// 生成一个合法签名事件
async function makeSignedEvent(data: unknown = { test: 'hello' }) {
  const key = await generateOperatorKey()
  const unsigned = createEvent(
    'intent.broadcast',
    { type: 'test', data, summary: 'test event' },
    ['tag:test'],
    key.publicKey,
  )
  const signed = await signEvent(unsigned, key.privateKey)
  return { signed, key }
}

describe('B3 - 事件接收与验证', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createInMemoryDb()
  })

  describe('handleEvent - 基本验证', () => {
    it('接受合法签名事件', async () => {
      const { signed } = await makeSignedEvent()
      const result = await handleEvent(db, signed)
      expect(result.ok).toBe(true)
      expect(result.eventId).toBe(signed.id)
    })

    it('拒绝非对象输入', async () => {
      const result = await handleEvent(db, 'not an object')
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('拒绝 null', async () => {
      const result = await handleEvent(db, null)
      expect(result.ok).toBe(false)
    })

    it('拒绝缺少 id 字段的事件', async () => {
      const { signed } = await makeSignedEvent()
      const bad = { ...signed, id: undefined }
      const result = await handleEvent(db, bad)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('id')
    })

    it('拒绝缺少 sig 字段的事件', async () => {
      const { signed } = await makeSignedEvent()
      const bad = { ...signed, sig: undefined }
      const result = await handleEvent(db, bad)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('sig')
    })

    it('拒绝缺少 kind 字段的事件', async () => {
      const { signed } = await makeSignedEvent()
      const bad = { ...signed, kind: undefined }
      const result = await handleEvent(db, bad)
      expect(result.ok).toBe(false)
    })

    it('拒绝篡改内容后的事件', async () => {
      const { signed } = await makeSignedEvent()
      const tampered = {
        ...signed,
        content: { ...signed.content, hacked: true },
      }
      const result = await handleEvent(db, tampered)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('signature')
    })

    it('拒绝错误格式的 id', async () => {
      const { signed } = await makeSignedEvent()
      const bad = { ...signed, id: 'short-id' }
      const result = await handleEvent(db, bad)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('id')
    })
  })

  describe('handleEvent - 存储', () => {
    it('合法事件存储后可查询', async () => {
      const { signed } = await makeSignedEvent()
      await handleEvent(db, signed)
      const stored = getEvent(db, signed.id)
      expect(stored).not.toBeNull()
      expect(stored!.id).toBe(signed.id)
    })

    it('非法事件不存储', async () => {
      const { signed } = await makeSignedEvent()
      const tampered = { ...signed, content: { hacked: true } }
      await handleEvent(db, tampered)
      const stored = getEvent(db, tampered.id)
      expect(stored).toBeNull()
    })

    it('重复提交相同事件不报错（幂等）', async () => {
      const { signed } = await makeSignedEvent()
      const r1 = await handleEvent(db, signed)
      const r2 = await handleEvent(db, signed)
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
    })

    it('存储的事件包含完整字段', async () => {
      const { signed } = await makeSignedEvent({ what: 'test', learned: 'something' })
      await handleEvent(db, signed)
      const stored = getEvent(db, signed.id)
      expect(stored!.kind).toBe(signed.kind)
      expect(stored!.pubkey).toBe(signed.pubkey)
      expect(stored!.sig).toBe(signed.sig)
    })
  })

  describe('handleRawMessage - WebSocket 消息处理', () => {
    it('解析并处理合法 JSON 事件', async () => {
      const { signed } = await makeSignedEvent()
      const result = await handleRawMessage(db, JSON.stringify(signed))
      expect(result.ok).toBe(true)
    })

    it('拒绝无效 JSON', async () => {
      const result = await handleRawMessage(db, 'not json {')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('JSON')
    })

    it('忽略 pong 消息（返回 ok）', async () => {
      const result = await handleRawMessage(
        db,
        JSON.stringify({ type: 'pong', timestamp: Date.now() })
      )
      expect(result.ok).toBe(true)
      expect(result.eventId).toBeUndefined()
    })

    it('拒绝篡改的事件 JSON', async () => {
      const { signed } = await makeSignedEvent()
      const tampered = { ...signed, content: { hacked: true } }
      const result = await handleRawMessage(db, JSON.stringify(tampered))
      expect(result.ok).toBe(false)
    })
  })

  describe('HTTP REST 兼容层', () => {
    let app: ReturnType<typeof createApp>

    beforeEach(() => {
      app = createApp(db)
    })

    it('POST /api/events 接受合法事件，返回 201', async () => {
      const { signed } = await makeSignedEvent()
      const res = await app.fetch(
        new Request('http://localhost/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signed),
        })
      )
      expect(res.status).toBe(201)
      const body = await res.json() as { ok: boolean; eventId: string }
      expect(body.ok).toBe(true)
      expect(body.eventId).toBe(signed.id)
    })

    it('POST /api/events 拒绝非法事件，返回 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invalid: 'event' }),
        })
      )
      expect(res.status).toBe(400)
      const body = await res.json() as { ok: boolean; error: string }
      expect(body.ok).toBe(false)
    })

    it('POST /api/events 拒绝篡改事件，返回 400', async () => {
      const { signed } = await makeSignedEvent()
      const tampered = { ...signed, content: { hacked: true } }
      const res = await app.fetch(
        new Request('http://localhost/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tampered),
        })
      )
      expect(res.status).toBe(400)
    })

    it('GET /api/events/:id 返回已存储事件', async () => {
      const { signed } = await makeSignedEvent()
      await handleEvent(db, signed)
      const res = await app.fetch(
        new Request(`http://localhost/api/events/${signed.id}`)
      )
      expect(res.status).toBe(200)
      const body = await res.json() as { id: string }
      expect(body.id).toBe(signed.id)
    })

    it('GET /api/events/:id 不存在时返回 404', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/events/0000000000000000000000000000000000000000000000000000000000000000')
      )
      expect(res.status).toBe(404)
    })
  })
})
