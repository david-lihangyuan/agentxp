/**
 * B4 - 经验发布与存储测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb } from '../src/db.js'
import {
  initExperiencesSchema,
  publishExperience,
  getExperience,
  listExperiencesByOperator,
  listExperiencesByPulse,
  updatePulseState,
  updateEmbedding,
} from '../src/experience-store.js'
import { generateOperatorKey, createEvent, signEvent } from '@serendip/protocol'
import type Database from 'better-sqlite3'

// 辅助：生成已签名的 intent.broadcast 事件
async function makeExperienceEvent(overrides: Record<string, unknown> = {}) {
  const key = await generateOperatorKey()
  const content = {
    title: '如何在 Bun 中使用 SQLite',
    summary: '直接用 better-sqlite3，不需要 ORM，性能更好',
    tags: ['bun', 'sqlite', 'database'],
    difficulty: 'easy',
    outcome: 'success',
    ...overrides,
  }
  const unsigned = createEvent('intent.broadcast', content, [], key.publicKey)
  const signed = await signEvent(unsigned, key.privateKey)
  return { signed, key }
}

async function makeWrongKindEvent() {
  const key = await generateOperatorKey()
  const unsigned = createEvent('identity.register', { test: 'hello' }, [], key.publicKey)
  const signed = await signEvent(unsigned, key.privateKey)
  return { signed, key }
}

describe('B4 - 经验发布与存储', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
  })

  describe('initExperiencesSchema', () => {
    it('建表成功，可以重复调用（幂等）', () => {
      // 已在 beforeEach 调用过，再调一次不应报错
      expect(() => initExperiencesSchema(db)).not.toThrow()
    })

    it('experiences 表存在', () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiences'")
        .get()
      expect(row).toBeTruthy()
    })
  })

  describe('publishExperience', () => {
    it('发布合法 intent.broadcast 事件成功', async () => {
      const { signed } = await makeExperienceEvent()
      const result = publishExperience(db, signed)
      expect(result.ok).toBe(true)
      expect(result.experienceId).toBe(signed.id)
    })

    it('发布后 pulse_state 默认为 dormant', async () => {
      const { signed } = await makeExperienceEvent()
      publishExperience(db, signed)
      const exp = getExperience(db, signed.id)
      expect(exp?.pulse_state).toBe('dormant')
    })

    it('拒绝非 intent.broadcast 的事件 kind', async () => {
      const { signed } = await makeWrongKindEvent()
      const result = publishExperience(db, signed)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('intent.broadcast')
    })

    it('拒绝缺少 title 的内容', async () => {
      const { signed } = await makeExperienceEvent({ title: undefined })
      const result = publishExperience(db, signed)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('title')
    })

    it('拒绝空 title', async () => {
      const { signed } = await makeExperienceEvent({ title: '   ' })
      const result = publishExperience(db, signed)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('title')
    })

    it('拒绝缺少 summary 的内容', async () => {
      const { signed } = await makeExperienceEvent({ summary: undefined })
      const result = publishExperience(db, signed)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('summary')
    })

    it('发布后可以通过 getExperience 读回', async () => {
      const { signed, key } = await makeExperienceEvent()
      publishExperience(db, signed)
      const exp = getExperience(db, signed.id)
      expect(exp).not.toBeNull()
      expect(exp?.title).toBe('如何在 Bun 中使用 SQLite')
      expect(exp?.summary).toBe('直接用 better-sqlite3，不需要 ORM，性能更好')
      expect(exp?.tags).toEqual(['bun', 'sqlite', 'database'])
      expect(exp?.difficulty).toBe('easy')
      expect(exp?.outcome).toBe('success')
      expect(exp?.operator_pubkey).toBe(key.publicKey)
      expect(exp?.event_id).toBe(signed.id)
    })

    it('同一事件重复发布幂等（不报错，不重复插入）', async () => {
      const { signed } = await makeExperienceEvent()
      const r1 = publishExperience(db, signed)
      const r2 = publishExperience(db, signed)
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
      // 只有一条记录
      const count = db.prepare('SELECT COUNT(*) as n FROM experiences').get() as { n: number }
      expect(count.n).toBe(1)
    })

    it('difficulty 不合法时被忽略（存为 null）', async () => {
      const { signed } = await makeExperienceEvent({ difficulty: 'very-hard' })
      publishExperience(db, signed)
      const exp = getExperience(db, signed.id)
      expect(exp?.difficulty).toBeUndefined()
    })

    it('outcome 不合法时被忽略（存为 null）', async () => {
      const { signed } = await makeExperienceEvent({ outcome: 'unknown' })
      publishExperience(db, signed)
      const exp = getExperience(db, signed.id)
      expect(exp?.outcome).toBeUndefined()
    })

    it('tags 中非字符串值被过滤', async () => {
      const { signed } = await makeExperienceEvent({ tags: ['valid', 42, null, 'also-valid'] })
      publishExperience(db, signed)
      const exp = getExperience(db, signed.id)
      expect(exp?.tags).toEqual(['valid', 'also-valid'])
    })

    it('tags 不存在时默认为空数组', async () => {
      const { signed } = await makeExperienceEvent({ tags: undefined })
      publishExperience(db, signed)
      const exp = getExperience(db, signed.id)
      expect(exp?.tags).toEqual([])
    })

    it('embedding 初始为 undefined（stub，等待后续服务填充）', async () => {
      const { signed } = await makeExperienceEvent()
      publishExperience(db, signed)
      const exp = getExperience(db, signed.id)
      expect(exp?.embedding).toBeUndefined()
    })
  })

  describe('getExperience', () => {
    it('不存在的 ID 返回 null', () => {
      const result = getExperience(db, 'nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('listExperiencesByOperator', () => {
    it('返回该 operator 的所有经验', async () => {
      const key = await generateOperatorKey()
      // 发布 3 条经验
      for (let i = 0; i < 3; i++) {
        const content = { title: `经验 ${i}`, summary: `摘要 ${i}` }
        const unsigned = createEvent('intent.broadcast', content, [], key.publicKey)
        const signed = await signEvent(unsigned, key.privateKey)
        publishExperience(db, signed)
      }
      const results = listExperiencesByOperator(db, key.publicKey)
      expect(results).toHaveLength(3)
      expect(results.every(e => e.operator_pubkey === key.publicKey)).toBe(true)
    })

    it('不同 operator 的经验互不可见', async () => {
      const keyA = await generateOperatorKey()
      const keyB = await generateOperatorKey()

      const unsignedA = createEvent('intent.broadcast', { title: 'A经验', summary: 'A摘要' }, [], keyA.publicKey)
      const signedA = await signEvent(unsignedA, keyA.privateKey)
      publishExperience(db, signedA)

      const unsignedB = createEvent('intent.broadcast', { title: 'B经验', summary: 'B摘要' }, [], keyB.publicKey)
      const signedB = await signEvent(unsignedB, keyB.privateKey)
      publishExperience(db, signedB)

      expect(listExperiencesByOperator(db, keyA.publicKey)).toHaveLength(1)
      expect(listExperiencesByOperator(db, keyB.publicKey)).toHaveLength(1)
    })

    it('支持 limit 和 offset 分页', async () => {
      const key = await generateOperatorKey()
      for (let i = 0; i < 5; i++) {
        const unsigned = createEvent('intent.broadcast', { title: `经验${i}`, summary: `摘要${i}` }, [], key.publicKey)
        const signed = await signEvent(unsigned, key.privateKey)
        publishExperience(db, signed)
      }
      const page1 = listExperiencesByOperator(db, key.publicKey, 2, 0)
      const page2 = listExperiencesByOperator(db, key.publicKey, 2, 2)
      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
      // 两页内容不重叠
      const ids1 = page1.map(e => e.id)
      const ids2 = page2.map(e => e.id)
      expect(ids1.some(id => ids2.includes(id))).toBe(false)
    })
  })

  describe('listExperiencesByPulse', () => {
    it('新发布的经验出现在 dormant 列表', async () => {
      const { signed } = await makeExperienceEvent()
      publishExperience(db, signed)
      const dormant = listExperiencesByPulse(db, 'dormant')
      expect(dormant.some(e => e.id === signed.id)).toBe(true)
    })

    it('非 dormant 列表不包含新发布的经验', async () => {
      const { signed } = await makeExperienceEvent()
      publishExperience(db, signed)
      const discovered = listExperiencesByPulse(db, 'discovered')
      expect(discovered.some(e => e.id === signed.id)).toBe(false)
    })
  })

  describe('updatePulseState', () => {
    it('可以把 dormant → discovered', async () => {
      const { signed } = await makeExperienceEvent()
      publishExperience(db, signed)
      const updated = updatePulseState(db, signed.id, 'discovered')
      expect(updated).toBe(true)
      expect(getExperience(db, signed.id)?.pulse_state).toBe('discovered')
    })

    it('状态可以全路径流转', async () => {
      const { signed } = await makeExperienceEvent()
      publishExperience(db, signed)
      const states: Array<'dormant' | 'discovered' | 'verified' | 'propagating'> = [
        'discovered', 'verified', 'propagating',
      ]
      for (const state of states) {
        updatePulseState(db, signed.id, state)
        expect(getExperience(db, signed.id)?.pulse_state).toBe(state)
      }
    })

    it('不存在的 ID 返回 false', () => {
      const result = updatePulseState(db, 'nonexistent', 'discovered')
      expect(result).toBe(false)
    })
  })

  describe('updateEmbedding', () => {
    it('可以更新 embedding', async () => {
      const { signed } = await makeExperienceEvent()
      publishExperience(db, signed)
      const embedding = Array.from({ length: 10 }, (_, i) => i * 0.1)
      const updated = updateEmbedding(db, signed.id, embedding)
      expect(updated).toBe(true)
      const exp = getExperience(db, signed.id)
      expect(exp?.embedding).toEqual(embedding)
    })

    it('不存在的 ID 返回 false', () => {
      const result = updateEmbedding(db, 'nonexistent', [0.1, 0.2])
      expect(result).toBe(false)
    })
  })
})
