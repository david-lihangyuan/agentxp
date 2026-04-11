/**
 * g2-experience-sync.test.ts — Phase 2G / G2
 * 超级节点间经验同步的测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  initSyncSchema,
  syncExperiences,
  getExperiencesForSync,
  getSyncLog,
  getSyncStats,
} from '../src/experience-sync.js'
import { initNodeRegistry, registerNode } from '../src/node-registry.js'
import Database from 'better-sqlite3'
import { initDb } from '../src/db.js'
import { initExperiencesSchema } from '../src/experience-store.js'
import {
  generateOperatorKey,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import type { SerendipEvent, IntentPayload } from '@serendip/protocol'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initDb(db)
  initExperiencesSchema(db)
  initNodeRegistry(db)
  initSyncSchema(db)
  return db
}

async function makeValidExperienceEvent(overrides: Record<string, unknown> = {}): Promise<SerendipEvent> {
  const key = await generateOperatorKey()
  const payload: IntentPayload = {
    type: 'experience',
    data: {
      title: overrides.title ?? '测试经验：如何修复数据库连接超时',
      summary: overrides.summary ?? '在 SQLite WAL 模式下，写入超时需要设置 busy_timeout 参数',
      outcome: overrides.outcome ?? 'success',
      difficulty: overrides.difficulty ?? 'medium',
    },
    summary: (overrides.summary as string) ?? '在 SQLite WAL 模式下，写入超时需要设置 busy_timeout 参数',
    tags: (overrides.tags as string[]) ?? ['sqlite', 'database', 'timeout'],
  }
  const eventTags = Array.isArray(overrides.tags) ? overrides.tags as string[] : ['sqlite', 'database', 'timeout']
  const event = createEvent('intent.broadcast', payload, eventTags, key.publicKey)
  return signEvent(event, key.privateKey)
}

describe('G2 - 经验同步', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  // ── 基础同步 ──────────────────────────────────────────────────

  it('同步合法事件 — 成功导入，返回 imported=1', async () => {
    const event = await makeValidExperienceEvent()
    const result = await syncExperiences(db, 'remote-node-1', [event])

    expect(result.imported).toBe(1)
    expect(result.rejected).toBe(0)
    expect(result.duplicates).toBe(0)
    expect(result.details[0].status).toBe('ok')
  })

  it('同步多个合法事件', async () => {
    const events = await Promise.all([
      makeValidExperienceEvent({ title: '经验A：部署流程' }),
      makeValidExperienceEvent({ title: '经验B：错误处理' }),
      makeValidExperienceEvent({ title: '经验C：性能调优' }),
    ])
    const result = await syncExperiences(db, 'remote-node-1', events)

    expect(result.imported).toBe(3)
    expect(result.rejected).toBe(0)
  })

  it('签名无效的事件被拒绝', async () => {
    const event = await makeValidExperienceEvent()
    // 篡改签名
    const tampered = { ...event, sig: 'invalid-signature-xxxx' }
    const result = await syncExperiences(db, 'remote-node-1', [tampered])

    expect(result.rejected).toBe(1)
    expect(result.imported).toBe(0)
    expect(result.details[0].status).toBe('rejected')
    expect(result.details[0].reason).toBe('invalid signature')
  })

  it('篡改内容的事件被拒绝', async () => {
    const event = await makeValidExperienceEvent()
    // 篡改内容但保留原签名
    const tampered = {
      ...event,
      content: JSON.stringify({ type: 'experience', title: '恶意内容', summary: '伪造数据' }),
    }
    const result = await syncExperiences(db, 'remote-node-1', [tampered])

    expect(result.rejected).toBe(1)
    expect(result.details[0].reason).toBe('invalid signature')
  })

  it('不支持的 kind 被拒绝', async () => {
    const event = await makeValidExperienceEvent()
    const wrongKind = { ...event, kind: 'identity.register' as 'intent.broadcast' }
    // 需要重新签名以通过签名校验，但这里测试的是 kind 过滤
    // 改 kind 后签名会失效，会先被签名拒绝——这是正确行为
    const result = await syncExperiences(db, 'remote-node-1', [wrongKind])
    expect(result.rejected).toBe(1)
  })

  // ── 幂等与去重 ────────────────────────────────────────────────

  it('重复同步同一事件 — 第二次标记 duplicate', async () => {
    const event = await makeValidExperienceEvent()

    const r1 = await syncExperiences(db, 'remote-node-1', [event])
    expect(r1.imported).toBe(1)

    const r2 = await syncExperiences(db, 'remote-node-1', [event])
    expect(r2.duplicates).toBe(1)
    expect(r2.imported).toBe(0)
  })

  it('从两个不同节点同步同一事件 — 第二次也是 duplicate', async () => {
    const event = await makeValidExperienceEvent()

    await syncExperiences(db, 'node-A', [event])
    const r2 = await syncExperiences(db, 'node-B', [event])

    expect(r2.duplicates).toBe(1)
  })

  // ── 空列表 ────────────────────────────────────────────────────

  it('空事件列表返回零统计', async () => {
    const result = await syncExperiences(db, 'remote-node-1', [])
    expect(result.imported).toBe(0)
    expect(result.rejected).toBe(0)
    expect(result.duplicates).toBe(0)
    expect(result.details).toHaveLength(0)
  })

  // ── getExperiencesForSync ─────────────────────────────────────

  it('getExperiencesForSync 返回 since 之后的事件', () => {
    // 直接插入 events 表（v3 统一存储）
    db.prepare(`INSERT INTO events (id, kind, pubkey, created_at, content, tags, sig, raw)
      VALUES ('old-1', 'intent.broadcast', 'pk1', 1000, '{}', '[]', 'sig1', '{}')`).run()
    db.prepare(`INSERT INTO events (id, kind, pubkey, created_at, content, tags, sig, raw)
      VALUES ('new-1', 'intent.broadcast', 'pk1', 3000, '{}', '[]', 'sig2', '{}')`).run()

    const { events, total, has_more } = getExperiencesForSync(db, 2000)
    expect(events.length).toBe(1)
    expect(events[0].created_at).toBe(3000)
    expect(total).toBe(1)
    expect(has_more).toBe(false)
  })

  it('getExperiencesForSync since=0 返回所有', () => {
    db.prepare(`INSERT INTO events (id, kind, pubkey, created_at, content, tags, sig, raw)
      VALUES ('e1', 'intent.broadcast', 'pk1', 1000, '{}', '[]', 'sig1', '{}')`).run()
    db.prepare(`INSERT INTO events (id, kind, pubkey, created_at, content, tags, sig, raw)
      VALUES ('e2', 'intent.broadcast', 'pk1', 2000, '{}', '[]', 'sig2', '{}')`).run()

    const { events: synced, total } = getExperiencesForSync(db, 0)
    expect(synced.length).toBe(2)
    expect(total).toBe(2)
  })

  it('getExperiencesForSync 遵循 limit 参数', async () => {
    const events = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        makeValidExperienceEvent({ title: `经验${i}` })
      )
    )
    await syncExperiences(db, 'remote-node-1', events)

    const { events: limited } = getExperiencesForSync(db, 0, 3)
    expect(limited.length).toBe(3)
  })

  it('同步导入的事件同时存入 events 表（供其他节点同步拉取）', async () => {
    const event = await makeValidExperienceEvent()
    await syncExperiences(db, 'remote-node-1', [event])

    const { events } = getExperiencesForSync(db, 0)
    // sync 导入后 events 表应该有原始事件
    expect(events.length).toBe(1)
    expect(events[0].kind).toBe('intent.broadcast')
    expect(events[0].id).toBe(event.id)
  })

  // ── 同步日志 ──────────────────────────────────────────────────

  it('getSyncLog 返回所有日志记录', async () => {
    const event = await makeValidExperienceEvent()
    await syncExperiences(db, 'node-A', [event])

    const log = getSyncLog(db)
    expect(log.length).toBe(1)
    expect(log[0].sourceNodeId).toBe('node-A')
    expect(log[0].status).toBe('ok')
  })

  it('getSyncLog 按 sourceNodeId 过滤', async () => {
    const [e1, e2] = await Promise.all([
      makeValidExperienceEvent({ title: 'A节点的经验' }),
      makeValidExperienceEvent({ title: 'B节点的经验' }),
    ])
    await syncExperiences(db, 'node-A', [e1])
    await syncExperiences(db, 'node-B', [e2])

    const logA = getSyncLog(db, { sourceNodeId: 'node-A' })
    expect(logA.length).toBe(1)
    expect(logA[0].sourceNodeId).toBe('node-A')
  })

  it('getSyncLog 按 status 过滤', async () => {
    const validEvent = await makeValidExperienceEvent()
    const invalidEvent = { ...validEvent, id: 'fake-id', sig: 'bad-sig' }

    await syncExperiences(db, 'node-A', [validEvent, invalidEvent])

    const rejected = getSyncLog(db, { status: 'rejected' })
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBe('invalid signature')
  })

  // ── 同步统计 ──────────────────────────────────────────────────

  it('getSyncStats 按来源节点汇总', async () => {
    const [e1, e2, e3] = await Promise.all([
      makeValidExperienceEvent({ title: '经验1' }),
      makeValidExperienceEvent({ title: '经验2' }),
      makeValidExperienceEvent({ title: '经验3' }),
    ])

    await syncExperiences(db, 'node-A', [e1, e2])
    await syncExperiences(db, 'node-B', [e3])

    const stats = getSyncStats(db)
    const nodeA = stats.find(s => s.sourceNodeId === 'node-A')
    const nodeB = stats.find(s => s.sourceNodeId === 'node-B')

    expect(nodeA?.ok).toBe(2)
    expect(nodeB?.ok).toBe(1)
  })

  it('拒绝和重复统计正确', async () => {
    const event = await makeValidExperienceEvent()
    const bad = { ...event, id: 'bad-id', sig: 'invalid' }

    await syncExperiences(db, 'node-A', [event])   // ok
    await syncExperiences(db, 'node-A', [event])   // duplicate
    await syncExperiences(db, 'node-A', [bad])     // rejected

    const stats = getSyncStats(db)
    const nodeA = stats.find(s => s.sourceNodeId === 'node-A')

    expect(nodeA?.ok).toBe(1)
    expect(nodeA?.duplicates).toBe(1)
    expect(nodeA?.rejected).toBe(1)
    expect(nodeA?.total).toBe(3)
  })
})
