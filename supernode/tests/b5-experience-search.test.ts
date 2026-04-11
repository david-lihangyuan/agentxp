/**
 * B5 - 双通道语义搜索测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb } from '../src/db.js'
import { initExperiencesSchema, publishExperience } from '../src/experience-store.js'
import { searchExperiences } from '../src/experience-search.js'
import { generateOperatorKey, createEvent, signEvent } from '@serendip/protocol'
import type Database from 'better-sqlite3'

// 辅助：快速发布一条经验
async function publish(
  db: Database.Database,
  key: Awaited<ReturnType<typeof generateOperatorKey>>,
  data: { title: string; summary: string; tags?: string[]; difficulty?: string; outcome?: string },
) {
  const unsigned = createEvent('intent.broadcast', data, [], key.publicKey)
  const signed = await signEvent(unsigned, key.privateKey)
  publishExperience(db, signed)
  return signed.id
}

describe('B5 - 双通道语义搜索', () => {
  let db: Database.Database
  let key: Awaited<ReturnType<typeof generateOperatorKey>>

  beforeEach(async () => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
    key = await generateOperatorKey()
  })

  describe('基础搜索', () => {
    it('空库返回空结果', () => {
      const result = searchExperiences(db, { query: 'anything' })
      expect(result.results).toHaveLength(0)
    })

    it('无查询条件返回所有经验（精确通道）', async () => {
      await publish(db, key, { title: '经验1', summary: '摘要1' })
      await publish(db, key, { title: '经验2', summary: '摘要2' })
      const result = searchExperiences(db, { include_serendipity: false })
      expect(result.results.length).toBeGreaterThanOrEqual(2)
    })

    it('query_summary 包含搜索条件描述', () => {
      const result = searchExperiences(db, { query: 'SQLite' })
      expect(result.query_summary).toContain('SQLite')
    })

    it('无查询条件时 query_summary 为全量搜索', () => {
      const result = searchExperiences(db, {})
      expect(result.query_summary).toBe('全量搜索')
    })
  })

  describe('Precision 通道 - 关键词搜索', () => {
    it('标题中有关键词的经验排在前面', async () => {
      await publish(db, key, { title: 'SQLite 使用指南', summary: '数据库操作' })
      await publish(db, key, { title: '无关经验', summary: '完全不同的内容' })
      const result = searchExperiences(db, {
        query: 'SQLite',
        include_serendipity: false,
      })
      expect(result.results[0].experience.title).toContain('SQLite')
    })

    it('摘要中有关键词也能被找到', async () => {
      const id = await publish(db, key, { title: '通用标题', summary: 'SQLite 性能优化技巧' })
      const result = searchExperiences(db, {
        query: 'SQLite',
        include_serendipity: false,
      })
      expect(result.results.some(r => r.experience.id === id)).toBe(true)
    })

    it('多关键词时命中更多词的排名更高', async () => {
      await publish(db, key, { title: 'Bun SQLite', summary: 'SQLite 在 Bun 里很快' })
      await publish(db, key, { title: 'SQLite 简介', summary: '基础介绍' })
      const result = searchExperiences(db, {
        query: 'Bun SQLite',
        include_serendipity: false,
      })
      expect(result.results[0].score_breakdown.keyword_score).toBeGreaterThan(
        result.results[result.results.length - 1].score_breakdown.keyword_score,
      )
    })

    it('score_breakdown 包含所有字段', async () => {
      await publish(db, key, { title: 'SQLite 测试', summary: '测试摘要', tags: ['sqlite'] })
      const result = searchExperiences(db, {
        query: 'SQLite',
        tags: ['sqlite'],
        include_serendipity: false,
      })
      const breakdown = result.results[0].score_breakdown
      expect(breakdown).toHaveProperty('keyword_score')
      expect(breakdown).toHaveProperty('tag_score')
      expect(breakdown).toHaveProperty('freshness_score')
      expect(breakdown).toHaveProperty('serendipity_bonus')
      expect(breakdown).toHaveProperty('final_score')
    })

    it('所有分数都在 [0, 1] 范围内', async () => {
      await publish(db, key, { title: 'SQLite 测试', summary: '测试摘要', tags: ['sqlite'] })
      const result = searchExperiences(db, {
        query: 'SQLite',
        tags: ['sqlite'],
        include_serendipity: false,
      })
      for (const r of result.results) {
        const bd = r.score_breakdown
        expect(bd.keyword_score).toBeGreaterThanOrEqual(0)
        expect(bd.keyword_score).toBeLessThanOrEqual(1)
        expect(bd.tag_score).toBeGreaterThanOrEqual(0)
        expect(bd.tag_score).toBeLessThanOrEqual(1)
        expect(bd.freshness_score).toBeGreaterThanOrEqual(0)
        expect(bd.freshness_score).toBeLessThanOrEqual(1)
        expect(bd.serendipity_bonus).toBeGreaterThanOrEqual(0)
        expect(bd.serendipity_bonus).toBeLessThanOrEqual(1)
        expect(bd.final_score).toBeGreaterThanOrEqual(0)
        expect(bd.final_score).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('Precision 通道 - Tag 搜索', () => {
    it('tag 完全匹配的经验得分更高', async () => {
      await publish(db, key, { title: '经验A', summary: '摘要A', tags: ['sqlite', 'bun'] })
      await publish(db, key, { title: '经验B', summary: '摘要B', tags: ['python'] })
      const result = searchExperiences(db, {
        tags: ['sqlite'],
        include_serendipity: false,
      })
      expect(result.results[0].experience.title).toBe('经验A')
      expect(result.results[0].score_breakdown.tag_score).toBeGreaterThan(0)
    })

    it('tag 搜索时无匹配的经验不出现在 precision 通道', async () => {
      await publish(db, key, { title: '经验A', summary: '摘要A', tags: ['sqlite'] })
      const result = searchExperiences(db, {
        tags: ['python'],
        include_serendipity: false,
      })
      expect(result.results).toHaveLength(0)
    })

    it('返回 total_precision 计数', async () => {
      await publish(db, key, { title: '经验A', summary: '摘要A', tags: ['sqlite'] })
      await publish(db, key, { title: '经验B', summary: '摘要B', tags: ['sqlite'] })
      const result = searchExperiences(db, { tags: ['sqlite'], include_serendipity: false })
      expect(result.total_precision).toBe(2)
    })
  })

  describe('Serendipity 通道', () => {
    it('启用 serendipity 后会额外返回意外发现', async () => {
      // 发布有 sqlite tag 的（进 precision）
      await publish(db, key, { title: '经验A', summary: '摘要A', tags: ['sqlite'] })
      // 发布没有 sqlite tag 的（只进 serendipity）
      await publish(db, key, { title: '经验B', summary: '摘要B', tags: ['python', 'ai'] })
      await publish(db, key, { title: '经验C', summary: '摘要C', tags: ['rust', 'wasm'] })

      const resultWithSerendipity = searchExperiences(db, {
        tags: ['sqlite'],
        include_serendipity: true,
        serendipity_ratio: 0.5,
        limit: 10,
      })
      const resultWithout = searchExperiences(db, {
        tags: ['sqlite'],
        include_serendipity: false,
      })

      expect(resultWithSerendipity.results.length).toBeGreaterThan(resultWithout.results.length)
    })

    it('serendipity 结果的 channel 字段为 serendipity', async () => {
      await publish(db, key, { title: '经验A', summary: '摘要A', tags: ['sqlite'] })
      await publish(db, key, { title: '经验B', summary: '摘要B', tags: ['rust'] })
      await publish(db, key, { title: '经验C', summary: '摘要C', tags: ['python'] })

      const result = searchExperiences(db, {
        tags: ['sqlite'],
        include_serendipity: true,
        serendipity_ratio: 0.5,
        limit: 10,
      })
      const serendipityResults = result.results.filter(r => r.channel === 'serendipity')
      expect(serendipityResults.length).toBeGreaterThan(0)
    })

    it('precision 结果的 channel 字段为 precision', async () => {
      await publish(db, key, { title: '经验A', summary: '摘要A', tags: ['sqlite'] })
      const result = searchExperiences(db, {
        tags: ['sqlite'],
        include_serendipity: true,
      })
      const precisionResults = result.results.filter(r => r.channel === 'precision')
      expect(precisionResults.length).toBeGreaterThan(0)
    })

    it('返回 total_serendipity 计数', async () => {
      await publish(db, key, { title: '经验A', summary: '摘要A', tags: ['sqlite'] })
      await publish(db, key, { title: '经验B', summary: '摘要B', tags: ['python'] })
      const result = searchExperiences(db, {
        tags: ['sqlite'],
        include_serendipity: true,
      })
      expect(result.total_serendipity).toBeGreaterThanOrEqual(0)
    })

    it('include_serendipity=false 时 total_serendipity 为 0', async () => {
      await publish(db, key, { title: '经验A', summary: '摘要A', tags: ['sqlite'] })
      const result = searchExperiences(db, {
        tags: ['sqlite'],
        include_serendipity: false,
      })
      expect(result.total_serendipity).toBe(0)
    })
  })

  describe('过滤条件', () => {
    it('operator_pubkey 过滤：只返回该 operator 的经验', async () => {
      const keyB = await generateOperatorKey()
      await publish(db, key, { title: '经验A', summary: '摘要A' })
      await publish(db, keyB, { title: '经验B', summary: '摘要B' })

      const result = searchExperiences(db, {
        operator_pubkey: key.publicKey,
        include_serendipity: false,
      })
      expect(result.results.every(r => r.experience.operator_pubkey === key.publicKey)).toBe(true)
      expect(result.results).toHaveLength(1)
    })

    it('pulse_states 过滤：只返回指定状态的经验', async () => {
      await publish(db, key, { title: '经验A', summary: '摘要A' })
      // 经验 A 是 dormant，搜索 discovered 应该返回空
      const result = searchExperiences(db, {
        pulse_states: ['discovered'],
        include_serendipity: false,
      })
      expect(result.results).toHaveLength(0)
    })
  })

  describe('分页', () => {
    it('limit 限制返回数量', async () => {
      for (let i = 0; i < 5; i++) {
        await publish(db, key, { title: `经验${i}`, summary: `摘要${i}` })
      }
      const result = searchExperiences(db, {
        include_serendipity: false,
        limit: 2,
      })
      expect(result.results.length).toBeLessThanOrEqual(2)
    })

    it('offset 正确分页', async () => {
      for (let i = 0; i < 5; i++) {
        await publish(db, key, { title: `经验${i}`, summary: `摘要${i}` })
      }
      const page1 = searchExperiences(db, { include_serendipity: false, limit: 2, offset: 0 })
      const page2 = searchExperiences(db, { include_serendipity: false, limit: 2, offset: 2 })

      const ids1 = page1.results.map(r => r.experience.id)
      const ids2 = page2.results.map(r => r.experience.id)
      expect(ids1.some(id => ids2.includes(id))).toBe(false)
    })
  })
})
