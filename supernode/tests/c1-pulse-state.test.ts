/**
 * C1 - Pulse 状态机测试
 * 经验生命状态：dormant → discovered → verified → propagating
 * 
 * 规则：
 * - 发布后初始 dormant
 * - 被搜索命中 → discovered（至少 dormant）
 * - 被验证 confirmed → verified（至少 discovered）
 * - 被引用 → propagating（至少 verified）
 * - 状态只进不退
 * - 每次状态变迁记录到 pulse_events 表，含人类可读 context
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb } from '../src/db.js'
import { initExperiencesSchema, publishExperience, getExperience } from '../src/experience-store.js'
import {
  initPulseSchema,
  transitionOnSearchHit,
  transitionOnVerify,
  transitionOnCite,
  getPulseEvents,
  getPulseState,
  type PulseEvent,
} from '../src/pulse.js'
import { generateOperatorKey, createEvent, signEvent } from '@serendip/protocol'
import type Database from 'better-sqlite3'

// ─── 辅助函数 ───

async function makeExperienceEvent(overrides: Record<string, unknown> = {}) {
  const key = await generateOperatorKey()
  const content = {
    title: '如何在 Docker 中配置 DNS',
    summary: 'Docker 容器 DNS 问题先重启容器清缓存，再检查 /etc/resolv.conf',
    tags: ['docker', 'dns', 'networking'],
    difficulty: 'medium',
    outcome: 'success',
    ...overrides,
  }
  const unsigned = createEvent('intent.broadcast', content, [], key.publicKey)
  const signed = await signEvent(unsigned, key.privateKey)
  return { signed, key }
}

async function publishTestExperience(db: Database.Database, overrides: Record<string, unknown> = {}) {
  const { signed, key } = await makeExperienceEvent(overrides)
  const result = publishExperience(db, signed)
  expect(result.ok).toBe(true)
  return { experienceId: result.experienceId!, key, event: signed }
}

describe('C1 - Pulse 状态机', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
    initPulseSchema(db)
  })

  // ─── Schema ───

  describe('initPulseSchema', () => {
    it('pulse_events 表建成功', () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pulse_events'")
        .get()
      expect(row).toBeTruthy()
    })

    it('幂等：重复调用不报错', () => {
      expect(() => initPulseSchema(db)).not.toThrow()
    })
  })

  // ─── 初始状态 ───

  describe('初始状态', () => {
    it('发布后经验是 dormant', async () => {
      const { experienceId } = await publishTestExperience(db)
      const state = getPulseState(db, experienceId)
      expect(state).toBe('dormant')
    })

    it('发布后没有 pulse events', async () => {
      const { experienceId } = await publishTestExperience(db)
      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(0)
    })
  })

  // ─── 搜索命中 → discovered ───

  describe('搜索命中 → discovered', () => {
    it('dormant → discovered：被搜索命中后状态提升', async () => {
      const { experienceId, key } = await publishTestExperience(db)

      // 另一个 operator 搜索命中
      const searcher = await generateOperatorKey()
      const changed = transitionOnSearchHit(db, experienceId, searcher.publicKey)
      expect(changed).toBe(true)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('discovered')
    })

    it('产生一条 pulse_event 记录', async () => {
      const { experienceId } = await publishTestExperience(db)
      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, searcher.publicKey)

      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('search_hit')
      expect(events[0].from_state).toBe('dormant')
      expect(events[0].to_state).toBe('discovered')
      expect(events[0].actor_pubkey).toBe(searcher.publicKey)
    })

    it('pulse_event 包含人类可读 context', async () => {
      const { experienceId } = await publishTestExperience(db)
      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, searcher.publicKey)

      const events = getPulseEvents(db, experienceId)
      expect(events[0].context).toBeTruthy()
      expect(typeof events[0].context).toBe('string')
      // context 应该包含有意义的描述
      expect(events[0].context.length).toBeGreaterThan(5)
    })

    it('同一经验被多次搜索命中只触发一次 dormant→discovered', async () => {
      const { experienceId } = await publishTestExperience(db)
      const s1 = await generateOperatorKey()
      const s2 = await generateOperatorKey()

      const changed1 = transitionOnSearchHit(db, experienceId, s1.publicKey)
      expect(changed1).toBe(true)

      const changed2 = transitionOnSearchHit(db, experienceId, s2.publicKey)
      // 状态没变（已经是 discovered），但仍然记录 pulse_event
      expect(changed2).toBe(false)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('discovered')

      // 两次搜索都记录了 event
      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(2)
      expect(events[1].from_state).toBe('discovered')
      expect(events[1].to_state).toBe('discovered')
    })

    it('同 operator 搜索自己的经验不触发状态变迁', async () => {
      const { experienceId, key } = await publishTestExperience(db)
      // 用同一个 pubkey 搜索
      const changed = transitionOnSearchHit(db, experienceId, key.publicKey)
      expect(changed).toBe(false)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('dormant')

      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(0)
    })

    it('不存在的经验返回 false', async () => {
      const searcher = await generateOperatorKey()
      const changed = transitionOnSearchHit(db, 'nonexistent', searcher.publicKey)
      expect(changed).toBe(false)
    })
  })

  // ─── 验证 → verified ───

  describe('验证 → verified', () => {
    it('discovered → verified：被验证后状态提升', async () => {
      const { experienceId } = await publishTestExperience(db)
      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, searcher.publicKey)

      const verifier = await generateOperatorKey()
      const changed = transitionOnVerify(db, experienceId, verifier.publicKey, 'confirmed')
      expect(changed).toBe(true)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('verified')
    })

    it('dormant → verified：即使跳过 discovered 也能直接到 verified', async () => {
      const { experienceId } = await publishTestExperience(db)
      const verifier = await generateOperatorKey()
      const changed = transitionOnVerify(db, experienceId, verifier.publicKey, 'confirmed')
      expect(changed).toBe(true)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('verified')
    })

    it('产生 pulse_event 记录', async () => {
      const { experienceId } = await publishTestExperience(db)
      const verifier = await generateOperatorKey()
      transitionOnVerify(db, experienceId, verifier.publicKey, 'confirmed')

      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('verification')
      expect(events[0].from_state).toBe('dormant')
      expect(events[0].to_state).toBe('verified')
      expect(events[0].actor_pubkey).toBe(verifier.publicKey)
    })

    it('denied 验证不触发状态提升', async () => {
      const { experienceId } = await publishTestExperience(db)
      const verifier = await generateOperatorKey()
      const changed = transitionOnVerify(db, experienceId, verifier.publicKey, 'denied')
      expect(changed).toBe(false)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('dormant')
    })

    it('denied 验证仍然记录 pulse_event', async () => {
      const { experienceId } = await publishTestExperience(db)
      const verifier = await generateOperatorKey()
      transitionOnVerify(db, experienceId, verifier.publicKey, 'denied')

      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('verification')
      expect(events[0].context).toContain('denied')
    })

    it('同 operator 验证自己的经验不触发状态变迁', async () => {
      const { experienceId, key } = await publishTestExperience(db)
      const changed = transitionOnVerify(db, experienceId, key.publicKey, 'confirmed')
      expect(changed).toBe(false)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('dormant')
    })

    it('已是 verified 时再次验证不降级但记录 event', async () => {
      const { experienceId } = await publishTestExperience(db)
      const v1 = await generateOperatorKey()
      transitionOnVerify(db, experienceId, v1.publicKey, 'confirmed')

      const v2 = await generateOperatorKey()
      const changed = transitionOnVerify(db, experienceId, v2.publicKey, 'confirmed')
      expect(changed).toBe(false)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('verified')

      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(2)
    })
  })

  // ─── 引用 → propagating ───

  describe('引用 → propagating', () => {
    it('verified → propagating：被引用后状态提升', async () => {
      const { experienceId } = await publishTestExperience(db)

      // 先到 verified
      const verifier = await generateOperatorKey()
      transitionOnVerify(db, experienceId, verifier.publicKey, 'confirmed')

      // 被引用
      const citer = await generateOperatorKey()
      const changed = transitionOnCite(db, experienceId, citer.publicKey)
      expect(changed).toBe(true)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('propagating')
    })

    it('dormant → propagating：引用可以直接跳到最高级', async () => {
      const { experienceId } = await publishTestExperience(db)
      const citer = await generateOperatorKey()
      const changed = transitionOnCite(db, experienceId, citer.publicKey)
      expect(changed).toBe(true)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('propagating')
    })

    it('产生 pulse_event 记录', async () => {
      const { experienceId } = await publishTestExperience(db)
      const citer = await generateOperatorKey()
      transitionOnCite(db, experienceId, citer.publicKey)

      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('citation')
      expect(events[0].from_state).toBe('dormant')
      expect(events[0].to_state).toBe('propagating')
    })

    it('同 operator 引用自己的经验不触发状态变迁', async () => {
      const { experienceId, key } = await publishTestExperience(db)
      const changed = transitionOnCite(db, experienceId, key.publicKey)
      expect(changed).toBe(false)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('dormant')
    })

    it('已是 propagating 时再次引用不变但记录 event', async () => {
      const { experienceId } = await publishTestExperience(db)
      const c1 = await generateOperatorKey()
      transitionOnCite(db, experienceId, c1.publicKey)

      const c2 = await generateOperatorKey()
      const changed = transitionOnCite(db, experienceId, c2.publicKey)
      expect(changed).toBe(false)

      const state = getPulseState(db, experienceId)
      expect(state).toBe('propagating')

      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(2)
    })
  })

  // ─── 状态不可回退 ───

  describe('状态不可回退', () => {
    it('propagating 状态的经验被搜索命中不会降回 discovered', async () => {
      const { experienceId } = await publishTestExperience(db)
      const citer = await generateOperatorKey()
      transitionOnCite(db, experienceId, citer.publicKey)
      expect(getPulseState(db, experienceId)).toBe('propagating')

      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, searcher.publicKey)
      expect(getPulseState(db, experienceId)).toBe('propagating')
    })

    it('verified 状态的经验被搜索命中不会降回 discovered', async () => {
      const { experienceId } = await publishTestExperience(db)
      const verifier = await generateOperatorKey()
      transitionOnVerify(db, experienceId, verifier.publicKey, 'confirmed')
      expect(getPulseState(db, experienceId)).toBe('verified')

      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, searcher.publicKey)
      expect(getPulseState(db, experienceId)).toBe('verified')
    })
  })

  // ─── getPulseEvents 过滤 ───

  describe('getPulseEvents 过滤', () => {
    it('按 experience_id 过滤', async () => {
      const { experienceId: id1 } = await publishTestExperience(db)
      const { experienceId: id2 } = await publishTestExperience(db, { title: '另一条经验', summary: '另一条' })

      const s = await generateOperatorKey()
      transitionOnSearchHit(db, id1, s.publicKey)
      transitionOnSearchHit(db, id2, s.publicKey)

      const events1 = getPulseEvents(db, id1)
      expect(events1).toHaveLength(1)
      expect(events1[0].experience_id).toBe(id1)

      const events2 = getPulseEvents(db, id2)
      expect(events2).toHaveLength(1)
      expect(events2[0].experience_id).toBe(id2)
    })

    it('since 参数过滤', async () => {
      const { experienceId } = await publishTestExperience(db)
      const s1 = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, s1.publicKey)

      const afterFirst = Date.now()

      // 小延迟保证时间戳不同
      await new Promise(r => setTimeout(r, 5))

      const v1 = await generateOperatorKey()
      transitionOnVerify(db, experienceId, v1.publicKey, 'confirmed')

      const allEvents = getPulseEvents(db, experienceId)
      expect(allEvents).toHaveLength(2)

      const recentEvents = getPulseEvents(db, experienceId, afterFirst)
      expect(recentEvents).toHaveLength(1)
      expect(recentEvents[0].event_type).toBe('verification')
    })

    it('按 agent pubkey 过滤（获取某 agent 所有经验的 pulse events）', async () => {
      const key1 = await generateOperatorKey()
      const content1 = {
        title: 'Agent1 经验',
        summary: 'Agent1 的经验内容',
        tags: ['test'],
      }
      const unsigned1 = createEvent('intent.broadcast', content1, [], key1.publicKey)
      const signed1 = await signEvent(unsigned1, key1.privateKey)
      publishExperience(db, signed1)

      const key2 = await generateOperatorKey()
      const content2 = {
        title: 'Agent2 经验',
        summary: 'Agent2 的经验内容',
        tags: ['test'],
      }
      const unsigned2 = createEvent('intent.broadcast', content2, [], key2.publicKey)
      const signed2 = await signEvent(unsigned2, key2.privateKey)
      publishExperience(db, signed2)

      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, signed1.id, searcher.publicKey)
      transitionOnSearchHit(db, signed2.id, searcher.publicKey)

      // 按 operator_pubkey 查 pulse events（通过关联 experience 表）
      const events = getPulseEventsByOperator(db, key1.publicKey)
      expect(events).toHaveLength(1)
      expect(events[0].experience_id).toBe(signed1.id)
    })
  })

  // ─── 完整生命周期 ───

  describe('完整生命周期', () => {
    it('dormant → discovered → verified → propagating', async () => {
      const { experienceId } = await publishTestExperience(db)

      expect(getPulseState(db, experienceId)).toBe('dormant')

      // 搜索命中
      const searcher = await generateOperatorKey()
      transitionOnSearchHit(db, experienceId, searcher.publicKey)
      expect(getPulseState(db, experienceId)).toBe('discovered')

      // 验证
      const verifier = await generateOperatorKey()
      transitionOnVerify(db, experienceId, verifier.publicKey, 'confirmed')
      expect(getPulseState(db, experienceId)).toBe('verified')

      // 引用
      const citer = await generateOperatorKey()
      transitionOnCite(db, experienceId, citer.publicKey)
      expect(getPulseState(db, experienceId)).toBe('propagating')

      // 完整事件历史
      const events = getPulseEvents(db, experienceId)
      expect(events).toHaveLength(3)
      expect(events[0].event_type).toBe('search_hit')
      expect(events[1].event_type).toBe('verification')
      expect(events[2].event_type).toBe('citation')

      // 每个事件都有 context
      for (const ev of events) {
        expect(ev.context.length).toBeGreaterThan(5)
      }
    })
  })
})

// 需要从 pulse.ts 导出
import { getPulseEventsByOperator } from '../src/pulse.js'
