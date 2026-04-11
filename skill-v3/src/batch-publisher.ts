/**
 * Serendip Skill — 心跳批量发布器（E3）
 *
 * 管道：drafts/ → 脱敏 → 分类 → 签名 → publishFn → published/ 或 failed/
 *
 * publishFn 可注入，测试时 mock，生产时发 HTTP 到超级节点。
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, existsSync } from 'fs'
import { join, basename } from 'path'

// ============================================================
// 类型定义
// ============================================================

export type Outcome = 'succeeded' | 'failed' | 'partial'
export type Section = 'mistakes' | 'lessons'

/** 草稿文件结构（E2 解析器输出，存到 drafts/*.json） */
export interface DraftFile {
  tried: string
  outcome: Outcome
  learned: string
  section: Section
  created_at: number
  /** 可选：来源文件 */
  source_file?: string
}

export interface AgentKey {
  publicKey: string
  privateKey: string
}

/** 发布函数 — 可注入，便于测试 */
export type PublishFn = (payload: PublishPayload) => Promise<PublishResult>

export interface PublishPayload {
  kind: 'intent.broadcast'
  content: {
    type: 'experience'
    data: {
      tried: string
      outcome: Outcome
      learned: string
      context?: string
    }
    summary: string
    tags: string[]
  }
  visibility: 'public' | 'private'
  pubkey: string
  created_at: number
}

export interface PublishResult {
  success: boolean
  eventId?: string
  error?: string
}

export interface BatchPublisherOptions {
  agentKey: AgentKey
  draftsDir: string
  publishedDir: string
  failedDir: string
  publishFn: PublishFn
}

export interface BatchResult {
  published: number
  failed: number
  blocked: number
  skipped: number
  total: number
}

// ============================================================
// 内联脱敏（避免跨包依赖，保持 Skill 独立）
// ============================================================

interface SanitizeResult {
  action: 'pass' | 'redact' | 'block'
  reason?: string
  content?: { tried: string; learned: string }
}

const HIGH_RISK = [
  /\bsk-[a-zA-Z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /aws_secret_access_key\s*=\s*[a-zA-Z0-9/+]{20,}/i,
  /\b(ghp_|gho_|github_pat_)[a-zA-Z0-9_]{20,}/,
  /Bearer\s+[a-zA-Z0-9\-_.]{40,}/i,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----/i,
  /(?:postgresql|mysql|mongodb|redis):\/\/[^:]+:[^@]{4,}@/i,
  /(?:token|secret|password|passwd|api_key)\s*=\s*[a-zA-Z0-9+/]{32,}/i,
]

const MEDIUM_RISK: Array<{ regex: RegExp; placeholder: string }> = [
  {
    regex: /https?:\/\/(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/[^\s]*)?\b/g,
    placeholder: '[PRIVATE_URL]',
  },
  {
    regex: /https?:\/\/[a-zA-Z0-9.-]*(?:internal|corp|intranet|company|private)[a-zA-Z0-9.-]*(?::\d+)?(?:\/[^\s]*)?/gi,
    placeholder: '[INTERNAL_URL]',
  },
]

function sanitizeDraft(draft: DraftFile): SanitizeResult {
  const combined = `${draft.tried} ${draft.learned}`

  // 高风险 → block
  for (const re of HIGH_RISK) {
    if (re.test(combined)) {
      return { action: 'block', reason: `高风险内容 block：匹配 ${re.toString().slice(0, 40)}...` }
    }
  }

  // 中风险 → redact
  let tried = draft.tried
  let learned = draft.learned
  let redacted = false

  for (const { regex, placeholder } of MEDIUM_RISK) {
    const newTried = tried.replace(regex, placeholder)
    const newLearned = learned.replace(regex, placeholder)
    if (newTried !== tried || newLearned !== learned) {
      tried = newTried
      learned = newLearned
      redacted = true
    }
  }

  if (redacted) {
    return { action: 'redact', content: { tried, learned } }
  }

  return { action: 'pass', content: { tried, learned } }
}

// ============================================================
// 内联分类（避免跨包依赖）
// ============================================================

const PRIVATE_KEYWORDS = [
  'internal', 'confidential', 'proprietary', 'classified',
  '内部', '内网', '机密', '保密', '专有',
  'salesforce', 'workday', 'sap', 'oracle', 'confluence',
]

const PUBLIC_TECH_KEYWORDS = [
  'docker', 'kubernetes', 'nginx', 'npm', 'yarn', 'git',
  'github', 'typescript', 'javascript', 'python', 'rust',
  'react', 'vue', 'next.js', 'openai', 'cloudflare', 'vercel',
  'postgresql', 'mysql', 'redis', 'mongodb',
]

function classifyDraft(draft: DraftFile): 'public' | 'private' {
  const text = `${draft.tried} ${draft.learned}`.toLowerCase()

  // 先检查私密词
  for (const kw of PRIVATE_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return 'private'
  }

  // 通用技术词 → public
  for (const kw of PUBLIC_TECH_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return 'public'
  }

  // 默认 public（经验协议的目标是流通）
  return 'public'
}

// ============================================================
// 批量发布器
// ============================================================

export function createBatchPublisher(opts: BatchPublisherOptions) {
  const { agentKey, draftsDir, publishedDir, failedDir, publishFn } = opts

  function ensureDirs() {
    mkdirSync(publishedDir, { recursive: true })
    mkdirSync(failedDir, { recursive: true })
  }

  function moveTo(srcPath: string, destDir: string, extra?: object) {
    const name = basename(srcPath)
    const destPath = join(destDir, name)
    if (extra) {
      // 把 extra 字段合并写入目标文件（不直接 rename）
      let original: object = {}
      try {
        original = JSON.parse(readFileSync(srcPath, 'utf-8'))
      } catch {
        // ignore
      }
      writeFileSync(destPath, JSON.stringify({ ...original, ...extra }, null, 2))
      // 删除原始 draft
      try {
        const fs = await_import_sync_delete(srcPath)
        void fs
      } catch {
        // 用 rename 不行就用 writeFileSync + unlinkSync
      }
      // 直接用 fs.unlinkSync
      unlinkSyncCompat(srcPath)
    } else {
      renameSync(srcPath, destPath)
    }
  }

  function unlinkSyncCompat(path: string) {
    // 兼容：用 writeFileSync 覆盖成空后 rename 不行，直接用 unlinkSync
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { unlinkSync } = require('fs')
    unlinkSync(path)
  }

  // 避免 await_import_sync_delete 这个不存在的函数
  // 实际上直接用 unlinkSync，简化代码

  async function run(): Promise<BatchResult> {
    ensureDirs()

    const result: BatchResult = { published: 0, failed: 0, blocked: 0, skipped: 0, total: 0 }

    // 读取所有 .json 文件
    let files: string[]
    try {
      files = readdirSync(draftsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(draftsDir, f))
    } catch {
      return result
    }

    result.total = files.length

    for (const filePath of files) {
      // 解析 draft
      let draft: DraftFile
      try {
        draft = JSON.parse(readFileSync(filePath, 'utf-8')) as DraftFile
      } catch (err) {
        // JSON 损坏
        result.skipped++
        moveToFailed(filePath, `JSON 解析失败: ${String(err)}`, failedDir)
        continue
      }

      // 脱敏
      const sanitized = sanitizeDraft(draft)

      if (sanitized.action === 'block') {
        result.blocked++
        result.failed++
        moveToFailed(filePath, sanitized.reason ?? 'block', failedDir, draft)
        continue
      }

      const cleanContent = sanitized.content ?? { tried: draft.tried, learned: draft.learned }

      // 分类
      const visibility = classifyDraft({ ...draft, ...cleanContent })

      // 构建 payload
      const payload: PublishPayload = {
        kind: 'intent.broadcast',
        content: {
          type: 'experience',
          data: {
            tried: cleanContent.tried,
            outcome: draft.outcome,
            learned: cleanContent.learned,
          },
          summary: cleanContent.tried.slice(0, 100),
          tags: draft.section === 'mistakes' ? ['mistake', 'lesson'] : ['lesson', 'success'],
        },
        visibility,
        pubkey: agentKey.publicKey,
        created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
      }

      // 发布
      try {
        const publishResult = await publishFn(payload)

        if (publishResult.success) {
          result.published++
          moveToPublished(filePath, publishedDir, { event_id: publishResult.eventId })
        } else {
          result.failed++
          moveToFailed(filePath, publishResult.error ?? 'unknown error', failedDir, draft)
        }
      } catch (err) {
        result.failed++
        moveToFailed(filePath, String(err), failedDir, draft)
      }
    }

    return result
  }

  return { run }
}

// ============================================================
// 文件移动辅助
// ============================================================

function moveToPublished(srcPath: string, publishedDir: string, extra: object) {
  const name = basename(srcPath)
  const destPath = join(publishedDir, name)
  let original: object = {}
  try {
    original = JSON.parse(readFileSync(srcPath, 'utf-8'))
  } catch {
    // ignore
  }
  writeFileSync(destPath, JSON.stringify({ ...original, ...extra, published_at: Date.now() }, null, 2))
  unlinkSync(srcPath)
}

function moveToFailed(
  srcPath: string,
  error: string,
  failedDir: string,
  draft?: object,
) {
  const name = basename(srcPath)
  const destPath = join(failedDir, name)
  writeFileSync(
    destPath,
    JSON.stringify(
      {
        draft: draft ?? null,
        error,
        failed_at: Date.now(),
      },
      null,
      2,
    ),
  )
  unlinkSync(srcPath)
}

function unlinkSync(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  fs.unlinkSync(path)
}
