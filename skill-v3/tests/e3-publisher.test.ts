import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync, writeFileSync, existsSync,
  mkdirSync, rmSync, readdirSync, readFileSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createBatchPublisher, type DraftFile, type PublishFn } from '../src/batch-publisher'

// ============================================================
// 测试辅助
// ============================================================

function makeDraft(overrides: Partial<DraftFile> = {}): DraftFile {
  return {
    tried: '在 Dockerfile 中用 multi-stage build 减少镜像体积，从 1.2GB 降到 180MB',
    outcome: 'succeeded',
    learned: 'multi-stage build 把 build 依赖留在前一阶段，只复制产物到最终镜像',
    section: 'lessons',
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  }
}

const AGENT_KEY = {
  publicKey: 'a'.repeat(64),
  privateKey: 'b'.repeat(64),
}

// ============================================================
// 测试
// ============================================================

describe('E3: 心跳批量发布', () => {
  let workspace: string
  let draftsDir: string
  let publishedDir: string
  let failedDir: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'serendip-e3-'))
    draftsDir = join(workspace, 'drafts')
    publishedDir = join(workspace, 'published')
    failedDir = join(workspace, 'failed')
    mkdirSync(draftsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function writeDraft(name: string, draft: DraftFile) {
    writeFileSync(join(draftsDir, name), JSON.stringify(draft, null, 2))
  }

  function makePublisher(publishFn?: PublishFn) {
    return createBatchPublisher({
      agentKey: AGENT_KEY,
      draftsDir,
      publishedDir,
      failedDir,
      publishFn: publishFn ?? (async () => ({ success: true, eventId: 'test-id' })),
    })
  }

  // --- 基础流程 ---

  it('空 drafts/ 目录 → 返回空结果', async () => {
    const publisher = makePublisher()
    const result = await publisher.run()
    expect(result.published).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.blocked).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('发布成功 → 草稿移动到 published/', async () => {
    writeDraft('draft-001.json', makeDraft())
    const publisher = makePublisher()

    const result = await publisher.run()
    expect(result.published).toBe(1)
    expect(result.failed).toBe(0)

    // draft 已移动
    expect(existsSync(join(draftsDir, 'draft-001.json'))).toBe(false)
    // published 里有文件
    const files = readdirSync(publishedDir)
    expect(files).toHaveLength(1)
  })

  it('发布失败 → 草稿移动到 failed/，记录原因', async () => {
    writeDraft('draft-fail.json', makeDraft())
    const publisher = makePublisher(async () => ({
      success: false,
      error: 'supernode unreachable',
    }))

    const result = await publisher.run()
    expect(result.published).toBe(0)
    expect(result.failed).toBe(1)

    expect(existsSync(join(draftsDir, 'draft-fail.json'))).toBe(false)
    const failedFiles = readdirSync(failedDir)
    expect(failedFiles).toHaveLength(1)

    // failed 文件包含错误原因
    const content = JSON.parse(readFileSync(join(failedDir, failedFiles[0]), 'utf-8'))
    expect(content.error).toBe('supernode unreachable')
    expect(content.draft).toBeDefined()
  })

  // --- 脱敏管道 ---

  it('高风险内容（API key）被 block → 移到 failed/，counted as blocked', async () => {
    writeDraft('draft-secret.json', makeDraft({
      tried: '用 sk-proj-abc123xyz456 API key 调用 OpenAI API，但忘记加 .gitignore',
      learned: '永远把 API key 放 .env 文件里，不要 hardcode，git commit 前检查',
    }))

    const publisher = makePublisher()
    const result = await publisher.run()

    expect(result.blocked).toBe(1)
    expect(result.published).toBe(0)

    // 移到 failed（blocked 也算 failed 的子类）
    const failedFiles = readdirSync(failedDir)
    expect(failedFiles).toHaveLength(1)

    const content = JSON.parse(readFileSync(join(failedDir, failedFiles[0]), 'utf-8'))
    expect(content.error).toContain('block')
  })

  it('中风险内容（内部 URL）被 redact 后可发布', async () => {
    const publishedPayloads: unknown[] = []
    writeDraft('draft-redact.json', makeDraft({
      tried: '访问 http://internal.company.com/api 调试内网接口，发现 CORS 配置错误',
      learned: 'CORS 错误在内网也要配置 Access-Control-Allow-Origin，不只是外网',
    }))

    const publisher = makePublisher(async (payload) => {
      publishedPayloads.push(payload)
      return { success: true, eventId: 'redacted-id' }
    })

    const result = await publisher.run()
    expect(result.published).toBe(1)

    // 发布的 payload 不包含内部 URL
    const published = publishedPayloads[0] as { content: { data: { tried: string } } }
    expect(published.content.data.tried).not.toContain('internal.company.com')
  })

  // --- 可见性分类 ---

  it('含内部关键词的内容自动设为 private', async () => {
    const publishedPayloads: unknown[] = []
    writeDraft('draft-private.json', makeDraft({
      tried: '调试公司内部 Salesforce CRM 集成接口，发现 webhook 格式变了',
      learned: '对接第三方 SaaS 时建议加 webhook payload 版本校验，防止静默升级破坏集成',
    }))

    const publisher = makePublisher(async (payload) => {
      publishedPayloads.push(payload)
      return { success: true, eventId: 'private-id' }
    })

    await publisher.run()
    expect(publishedPayloads).toHaveLength(1)
    const p = publishedPayloads[0] as { visibility: string }
    expect(p.visibility).toBe('private')
  })

  it('通用技术内容自动设为 public', async () => {
    const publishedPayloads: unknown[] = []
    writeDraft('draft-public.json', makeDraft({
      tried: '用 Docker multi-stage build 把 Node.js 镜像从 800MB 压缩到 120MB',
      learned: 'Alpine 基础镜像 + multi-stage 是标准做法，build 依赖不进最终镜像',
    }))

    const publisher = makePublisher(async (payload) => {
      publishedPayloads.push(payload)
      return { success: true, eventId: 'public-id' }
    })

    await publisher.run()
    expect(publishedPayloads).toHaveLength(1)
    const p = publishedPayloads[0] as { visibility: string }
    expect(p.visibility).toBe('public')
  })

  // --- 多条批量 ---

  it('批量处理多条 drafts', async () => {
    writeDraft('draft-1.json', makeDraft())
    writeDraft('draft-2.json', makeDraft())
    writeDraft('draft-3.json', makeDraft())

    const publisher = makePublisher()
    const result = await publisher.run()

    expect(result.published).toBe(3)
    expect(result.failed).toBe(0)
    expect(readdirSync(publishedDir)).toHaveLength(3)
    expect(readdirSync(draftsDir)).toHaveLength(0)
  })

  it('部分成功部分失败', async () => {
    writeDraft('draft-ok.json', makeDraft())
    writeDraft('draft-err.json', makeDraft())

    let callCount = 0
    const publisher = makePublisher(async () => {
      callCount++
      if (callCount % 2 === 0) return { success: false, error: 'network error' }
      return { success: true, eventId: `id-${callCount}` }
    })

    const result = await publisher.run()
    expect(result.published + result.failed).toBe(2)
  })

  // --- 格式验证 ---

  it('损坏的 draft JSON 被跳过，移到 failed/', async () => {
    writeFileSync(join(draftsDir, 'broken.json'), 'not valid json {{{')

    const publisher = makePublisher()
    const result = await publisher.run()

    expect(result.skipped).toBe(1)
    expect(result.published).toBe(0)
    const failedFiles = readdirSync(failedDir)
    expect(failedFiles).toHaveLength(1)
  })

  it('非 .json 文件被忽略', async () => {
    writeFileSync(join(draftsDir, 'readme.txt'), 'not a draft')
    writeDraft('valid.json', makeDraft())

    const publisher = makePublisher()
    const result = await publisher.run()

    expect(result.published).toBe(1)
  })

  // --- 发布 payload 结构 ---

  it('发布 payload 包含正确的经验数据结构', async () => {
    const captured: unknown[] = []
    writeDraft('draft-struct.json', makeDraft({
      tried: '在 Dockerfile 中用 multi-stage build 减少镜像体积从 1.2GB 到 180MB',
      outcome: 'succeeded',
      learned: 'build 依赖不进最终镜像，Alpine base + 只复制产物是标准做法',
    }))

    const publisher = makePublisher(async (payload) => {
      captured.push(payload)
      return { success: true, eventId: 'struct-test' }
    })

    await publisher.run()
    const payload = captured[0] as {
      kind: string
      content: { type: string; data: { tried: string; outcome: string; learned: string } }
      visibility: string
    }

    expect(payload.kind).toBe('intent.broadcast')
    expect(payload.content.type).toBe('experience')
    expect(payload.content.data.tried).toBeTruthy()
    expect(payload.content.data.outcome).toBe('succeeded')
    expect(payload.content.data.learned).toBeTruthy()
    expect(['public', 'private']).toContain(payload.visibility)
  })
})
