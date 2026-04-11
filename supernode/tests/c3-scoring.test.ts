/**
 * C3 - 积分计算（Experience Impact Score）测试
 * 
 * 核心规则（防作弊宪章）：
 * - 发布经验 +0（发布本身不值钱）
 * - 被不同 operator 搜索命中 +1（同 operator 不计，每日上限 +5）
 * - 被不同 operator 验证 confirmed +5（同 operator 不计）
 * - 被不同 operator 引用 +10（自引用不计）
 * - 引用链扩展递减：一层 100%，二层 50%，三层 25%
 * - 所有积分必须有独立第三方行为参与
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb } from '../src/db.js'
import { initExperiencesSchema, publishExperience } from '../src/experience-store.js'
import { initPulseSchema, transitionOnSearchHit, transitionOnVerify, transitionOnCite } from '../src/pulse.js'
import {
  initScoringSchema,
  recordSearchHitScore,
  recordVerificationScore,
  recordCitationScore,
  getScore,
  getScoreLedger,
  type ScoreLedgerEntry,
} from '../src/scoring.js'
import { generateOperatorKey, createEvent, signEvent } from '@serendip/protocol'
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

describe('C3 - 积分计算', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createInMemoryDb()
    initExperiencesSchema(db)
    initPulseSchema(db)
    initScoringSchema(db)
  })

  // ─── Schema ───

  describe('initScoringSchema', () => {
    it('score_ledger 表建成功', () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='score_ledger'")
        .get()
      expect(row).toBeTruthy()
    })

    it('幂等', () => {
      expect(() => initScoringSchema(db)).not.toThrow()
    })
  })

  // ─── 发布 = 0 分 ───

  describe('发布不计分', () => {
    it('发布经验后积分为 0', async () => {
      const { key } = await makeAndPublish(db)
      const score = getScore(db, key.publicKey)
      expect(score).toBe(0)
    })
  })

  // ─── 搜索命中 +1 ───

  describe('搜索命中积分', () => {
    it('不同 operator 搜索命中 +1', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const searcher = await generateOperatorKey()

      recordSearchHitScore(db, experienceId, searcher.publicKey)
      expect(getScore(db, key.publicKey)).toBe(1)
    })

    it('多次不同 operator 搜索累加', async () => {
      const { experienceId, key } = await makeAndPublish(db)

      for (let i = 0; i < 3; i++) {
        const s = await generateOperatorKey()
        recordSearchHitScore(db, experienceId, s.publicKey)
      }

      expect(getScore(db, key.publicKey)).toBe(3)
    })

    it('同 operator 搜索自己的经验不计分', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      recordSearchHitScore(db, experienceId, key.publicKey)
      expect(getScore(db, key.publicKey)).toBe(0)
    })

    it('每条经验每天搜索命中上限 +5', async () => {
      const { experienceId, key } = await makeAndPublish(db)

      for (let i = 0; i < 10; i++) {
        const s = await generateOperatorKey()
        recordSearchHitScore(db, experienceId, s.publicKey)
      }

      // 即使被 10 个不同 operator 搜到，当天上限 5
      expect(getScore(db, key.publicKey)).toBe(5)
    })

    it('不同经验的搜索命中分开算上限', async () => {
      const { experienceId: id1, key: key1 } = await makeAndPublish(db)
      // 同一个 operator 的另一条经验
      const content2 = {
        title: '另一条经验',
        summary: '另一条经验的内容',
        tags: ['test'],
      }
      const unsigned2 = createEvent('intent.broadcast', content2, [], key1.publicKey)
      const signed2 = await signEvent(unsigned2, key1.privateKey)
      publishExperience(db, signed2)
      const id2 = signed2.id

      // 每条各被搜 6 次
      for (let i = 0; i < 6; i++) {
        const s = await generateOperatorKey()
        recordSearchHitScore(db, id1, s.publicKey)
      }
      for (let i = 0; i < 6; i++) {
        const s = await generateOperatorKey()
        recordSearchHitScore(db, id2, s.publicKey)
      }

      // 每条上限 5，合计 10
      expect(getScore(db, key1.publicKey)).toBe(10)
    })
  })

  // ─── 验证 +5 ───

  describe('验证积分', () => {
    it('不同 operator confirmed 验证 +5', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const verifier = await generateOperatorKey()
      recordVerificationScore(db, experienceId, verifier.publicKey, 'confirmed')
      expect(getScore(db, key.publicKey)).toBe(5)
    })

    it('denied 验证不计分', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const verifier = await generateOperatorKey()
      recordVerificationScore(db, experienceId, verifier.publicKey, 'denied')
      expect(getScore(db, key.publicKey)).toBe(0)
    })

    it('同 operator 验证自己的经验不计分', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      recordVerificationScore(db, experienceId, key.publicKey, 'confirmed')
      expect(getScore(db, key.publicKey)).toBe(0)
    })

    it('多个不同 verifier 累加', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const v1 = await generateOperatorKey()
      const v2 = await generateOperatorKey()
      recordVerificationScore(db, experienceId, v1.publicKey, 'confirmed')
      recordVerificationScore(db, experienceId, v2.publicKey, 'confirmed')
      expect(getScore(db, key.publicKey)).toBe(10)
    })
  })

  // ─── 引用 +10 ───

  describe('引用积分', () => {
    it('不同 operator 引用 +10', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const citer = await generateOperatorKey()
      recordCitationScore(db, experienceId, citer.publicKey)
      expect(getScore(db, key.publicKey)).toBe(10)
    })

    it('同 operator 自引用不计分', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      recordCitationScore(db, experienceId, key.publicKey)
      expect(getScore(db, key.publicKey)).toBe(0)
    })
  })

  // ─── 综合场景 ───

  describe('综合积分计算', () => {
    it('搜索 + 验证 + 引用 累计', async () => {
      const { experienceId, key } = await makeAndPublish(db)

      const searcher = await generateOperatorKey()
      recordSearchHitScore(db, experienceId, searcher.publicKey) // +1

      const verifier = await generateOperatorKey()
      recordVerificationScore(db, experienceId, verifier.publicKey, 'confirmed') // +5

      const citer = await generateOperatorKey()
      recordCitationScore(db, experienceId, citer.publicKey) // +10

      expect(getScore(db, key.publicKey)).toBe(16)
    })
  })

  // ─── Ledger ───

  describe('积分 Ledger', () => {
    it('记录每笔积分的来源', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const searcher = await generateOperatorKey()
      recordSearchHitScore(db, experienceId, searcher.publicKey)

      const ledger = getScoreLedger(db, key.publicKey)
      expect(ledger).toHaveLength(1)
      expect(ledger[0].experience_id).toBe(experienceId)
      expect(ledger[0].event_type).toBe('search_hit')
      expect(ledger[0].points).toBe(1)
      expect(ledger[0].actor_pubkey).toBe(searcher.publicKey)
    })

    it('ledger 按时间排序', async () => {
      const { experienceId, key } = await makeAndPublish(db)

      const s = await generateOperatorKey()
      recordSearchHitScore(db, experienceId, s.publicKey) // +1

      await new Promise(r => setTimeout(r, 5))

      const v = await generateOperatorKey()
      recordVerificationScore(db, experienceId, v.publicKey, 'confirmed') // +5

      const ledger = getScoreLedger(db, key.publicKey)
      expect(ledger).toHaveLength(2)
      expect(ledger[0].event_type).toBe('search_hit')
      expect(ledger[1].event_type).toBe('verification')
      expect(ledger[0].created_at).toBeLessThanOrEqual(ledger[1].created_at)
    })

    it('被拒绝的积分不入 ledger', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      // 同 operator 搜索 → 不计分
      recordSearchHitScore(db, experienceId, key.publicKey)

      const ledger = getScoreLedger(db, key.publicKey)
      expect(ledger).toHaveLength(0)
    })

    it('超出每日上限的不入 ledger', async () => {
      const { experienceId, key } = await makeAndPublish(db)

      for (let i = 0; i < 8; i++) {
        const s = await generateOperatorKey()
        recordSearchHitScore(db, experienceId, s.publicKey)
      }

      const ledger = getScoreLedger(db, key.publicKey)
      // 只有 5 条（每日上限）
      expect(ledger).toHaveLength(5)
      expect(getScore(db, key.publicKey)).toBe(5)
    })
  })

  // ─── 防作弊补充 ───

  describe('防作弊', () => {
    it('同一个 searcher 对同一条经验重复搜索只计一次', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const searcher = await generateOperatorKey()

      recordSearchHitScore(db, experienceId, searcher.publicKey)
      recordSearchHitScore(db, experienceId, searcher.publicKey)

      expect(getScore(db, key.publicKey)).toBe(1)
    })

    it('同一个 verifier 对同一条经验重复验证只计一次', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const verifier = await generateOperatorKey()

      recordVerificationScore(db, experienceId, verifier.publicKey, 'confirmed')
      recordVerificationScore(db, experienceId, verifier.publicKey, 'confirmed')

      expect(getScore(db, key.publicKey)).toBe(5)
    })

    it('同一个 citer 对同一条经验重复引用只计一次', async () => {
      const { experienceId, key } = await makeAndPublish(db)
      const citer = await generateOperatorKey()

      recordCitationScore(db, experienceId, citer.publicKey)
      recordCitationScore(db, experienceId, citer.publicKey)

      expect(getScore(db, key.publicKey)).toBe(10)
    })
  })
})
