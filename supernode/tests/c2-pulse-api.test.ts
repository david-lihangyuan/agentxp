/**
 * C2 - Pulse Events Pull API 测试
 * GET /api/pulse?since=<timestamp>&pubkey=<agent_pubkey>
 * 
 * Agent 心跳时拉取自己经验的变化通知
 * 每个事件含人类可读 context
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb } from '../src/db.js'
import { initExperiencesSchema, publishExperience } from '../src/experience-store.js'
import { initPulseSchema, transitionOnSearchHit, transitionOnVerify, transitionOnCite } from '../src/pulse.js'
import { createPulseApi } from '../src/pulse-api.js'
import { generateOperatorKey, createEvent, signEvent } from '@serendip/protocol'
import { Hono } from 'hono'
import type Database from 'better-sqlite3'

// ─── 辅助 ───

async function makeAndPublish(db: Database.Database, overrides: Record<string, unknown> = {}) {
  const key = await generateOperatorKey()
  const content = {
    title: 'Docker DNS 配置',
    summary: 'Docker 容器 DNS 问题先重启容器清缓存',
    tags: ['docker', 'dns'],
    ...overrides,
  }
  const unsigned = createEvent('intent.broadcast', content, [], key.publicKey)
  const signed = await signEvent(unsigned, key.privateKey)
  const result = publishExperience(db, signed)
  expect(result.ok).toBe(true)
  return { experienceId: result.experienceId!, key, event: signed }
}

describe('C2 - Pulse Events Pull API', () => {
  let db: Database.Database
  let app: Hono

  beforeEach(() => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
    initPulseSchema(db)
    app = new Hono()
    createPulseApi(app, db)
  })

  // ─── 基础端点 ───

  describe('GET /api/pulse', () => {
    it('无 pubkey 参数返回 400', async () => {
      const res = await app.request('/api/pulse')
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('pubkey')
    })

    it('有 pubkey 但没有 pulse events 返回空数组', async () => {
      const key = await generateOperatorKey()
      const res = await app.request(`/api/pulse?pubkey=${key.publicKey}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.events).toEqual([])
      expect(body.total).toBe(0)
    })

    it('返回该 operator 的经验的 pulse events', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, searcher.publicKey)

      const res = await app.request(`/api/pulse?pubkey=${key.publicKey}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.events).toHaveLength(1)
      expect(body.events[0].experience_id).toBe(experienceId)
      expect(body.events[0].event_type).toBe('search_hit')
      expect(body.events[0].context).toBeTruthy()
      expect(body.total).toBe(1)
    })

    it('since 参数过滤早期事件', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const s1 = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, s1.publicKey)

      const midpoint = Date.now()
      await new Promise(r => setTimeout(r, 5))

      const v1 = await generateOperatorKey()
      transitionOnVerify(db, experienceId, v1.publicKey, 'confirmed')

      // 不带 since → 返回全部
      const res1 = await app.request(`/api/pulse?pubkey=${key.publicKey}`)
      const body1 = await res1.json()
      expect(body1.events).toHaveLength(2)

      // 带 since → 只返回后面的
      const res2 = await app.request(`/api/pulse?pubkey=${key.publicKey}&since=${midpoint}`)
      const body2 = await res2.json()
      expect(body2.events).toHaveLength(1)
      expect(body2.events[0].event_type).toBe('verification')
    })

    it('不返回其他 operator 的 pulse events', async () => {
      const { experienceId: id1, key: key1 } = await makeAndPublish(db)
      const { experienceId: id2, key: key2 } = await makeAndPublish(db, {
        title: '另一条',
        summary: '另一条经验',
      })

      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, id1, searcher.publicKey)
      transitionOnSearchHit(db, id2, searcher.publicKey)

      const res1 = await app.request(`/api/pulse?pubkey=${key1.publicKey}`)
      const body1 = await res1.json()
      expect(body1.events).toHaveLength(1)
      expect(body1.events[0].experience_id).toBe(id1)

      const res2 = await app.request(`/api/pulse?pubkey=${key2.publicKey}`)
      const body2 = await res2.json()
      expect(body2.events).toHaveLength(1)
      expect(body2.events[0].experience_id).toBe(id2)
    })
  })

  // ─── 多类型事件 ───

  describe('多类型 pulse events', () => {
    it('完整生命周期的事件全部可拉取', async () => {
      const { experienceId, key } = await makeAndPublish(db)

      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, searcher.publicKey)

      const verifier = await generateOperatorKey()
      transitionOnVerify(db, experienceId, verifier.publicKey, 'confirmed')

      const citer = await generateOperatorKey()
      transitionOnCite(db, experienceId, citer.publicKey)

      const res = await app.request(`/api/pulse?pubkey=${key.publicKey}`)
      const body = await res.json()
      expect(body.events).toHaveLength(3)
      expect(body.events[0].event_type).toBe('search_hit')
      expect(body.events[1].event_type).toBe('verification')
      expect(body.events[2].event_type).toBe('citation')
    })

    it('每个事件都有 id、experience_id、event_type、context、created_at', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, searcher.publicKey)

      const res = await app.request(`/api/pulse?pubkey=${key.publicKey}`)
      const body = await res.json()
      const event = body.events[0]

      expect(event.id).toBeDefined()
      expect(event.experience_id).toBe(experienceId)
      expect(event.event_type).toBe('search_hit')
      expect(event.from_state).toBe('dormant')
      expect(event.to_state).toBe('discovered')
      expect(event.context).toBeTruthy()
      expect(typeof event.created_at).toBe('number')
    })
  })

  // ─── limit 参数 ───

  describe('limit 参数', () => {
    it('默认限制 100 条', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      // 产生多条事件
      for (let i = 0; i < 5; i++) {
        const s = await generateOperatorKey()
        transitionOnSearchHit(db, experienceId, s.publicKey)
      }

      const res = await app.request(`/api/pulse?pubkey=${key.publicKey}`)
      const body = await res.json()
      expect(body.events.length).toBeLessThanOrEqual(100)
    })

    it('可以指定 limit', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      for (let i = 0; i < 5; i++) {
        const s = await generateOperatorKey()
        transitionOnSearchHit(db, experienceId, s.publicKey)
      }

      const res = await app.request(`/api/pulse?pubkey=${key.publicKey}&limit=2`)
      const body = await res.json()
      expect(body.events).toHaveLength(2)
    })
  })

  // ─── 响应格式 ───

  describe('响应格式', () => {
    it('包含 events 数组和 total 计数', async () => {
      const key = await generateOperatorKey()
      const res = await app.request(`/api/pulse?pubkey=${key.publicKey}`)
      const body = await res.json()
      expect(body).toHaveProperty('events')
      expect(body).toHaveProperty('total')
      expect(Array.isArray(body.events)).toBe(true)
    })

    it('包含 query_summary 描述', async () => {
      const key = await generateOperatorKey()
      const res = await app.request(`/api/pulse?pubkey=${key.publicKey}`)
      const body = await res.json()
      expect(body).toHaveProperty('query_summary')
      expect(typeof body.query_summary).toBe('string')
    })
  })
})
