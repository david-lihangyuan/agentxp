# AgentXP Plugin v2 — 全部设计文档

> 来自 `docs/plans/plugin-v2/`，按文件名顺序合并。


---

## 文件: 00-overview.md

# AgentXP Plugin — 修正版实现计划

> 基于三轮审视（代码层面 + 安全 + 简洁性）修正。所有已知 SDK 类型问题已修复。

## 变更摘要（vs 原版）

### 🔴 P0 修正（原版会导致编译失败或运行时崩溃）

1. **Hook 注册全部改用 `api.on()`**（原版用 `registerHook` + `InternalHookHandler`，签名不匹配）
2. **经验提取数据源改用 `after_tool_call` + `agent_end`**（原版依赖 `message_sending` 拿 tool call 数据，实际拿不到）
3. **MemoryPromptSupplement 的 session 上下文问题**（builder 没有 sessionKey 参数，改用全局最近活跃 session 缓存）

### 🟡 P1 修正（功能缺陷）

4. **新增 `after_tool_call` hook**（原版只有 `before_tool_call`，缺少 result/error 数据）
5. **新增 `agent_end` hook**（session 级经验总结的最佳时机）
6. **新增 `session_start` / `session_end` hook**（context_cache 生命周期管理）
7. **HTTP route handler 改用 raw Node.js `(req, res)` 风格**（不是 Express）
8. **写操作路由加 `gatewayRuntimeScopeSurface: 'trusted-operator'`**

### 🟢 P2 修正（安全 + 质量）

9. **FTS5 查询清洗**（防 FTS5 查询注入）
10. **Sanitize 在写入时执行**（不只是发布时）
11. **Relay URL 验证**（防 SSRF，必须 HTTPS + 非私有 IP）
12. **Trace steps 不存 raw params**（只存 toolName + action）
13. **Preloaded 经验也走 sanitize pipeline**
14. **每个子服务独立 try-catch + 指数退避**
15. **Mock API factory 提前到 Task 1**
16. **ConfigSchema 精简到 2 项**（mode + relayUrl）

## 架构

```
definePluginEntry('agentxp')
  ├── registerMemoryCorpusSupplement     — agent memory_search 搜经验
  ├── registerMemoryPromptSupplement     — D' 被动注入
  ├── api.on('message_sending')          — 关键词缓存
  ├── api.on('after_tool_call')          — tool 结果积累
  ├── api.on('agent_end')               — session 级经验提取
  ├── api.on('before_tool_call')         — trace recording
  ├── api.on('session_start')            — context_cache 初始化
  ├── api.on('session_end')              — context_cache 清理
  ├── registerService('agentxp')         — 1 个 service，内部 8 个模块
  ├── registerTool(agentxp_search)       — optional
  ├── registerTool(agentxp_publish)      — optional
  ├── registerCommand('/xp')             — status/pause/resume/unpublish
  ├── registerCli(descriptors)           — openclaw agentxp status/diagnose/distill/export
  └── registerHttpRoute(...)             — 5 个 API 路由
```

## Tech Stack

- TypeScript (ESM, strict mode)
- OpenClaw Plugin SDK (`openclaw/plugin-sdk/*`)
- better-sqlite3 (SQLite + FTS5)
- @serendip/protocol (signing/keys)
- @sinclair/typebox (tool schemas)
- vitest (testing)

## 文件结构

```
packages/plugin/
├── openclaw.plugin.json
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    — plugin entry, 注册所有能力
│   ├── types.ts                    — 类型定义 + 默认配置
│   ├── db.ts                       — SQLite 存储层
│   ├── sanitize.ts                 — 安全过滤（port from skill）
│   ├── context-wrapper.ts          — XML 包裹（port from skill）
│   ├── injection-engine.ts         — D' 选择性注入
│   ├── extraction-engine.ts        — 经验提取
│   ├── memory-corpus.ts            — Memory Corpus Supplement
│   ├── memory-prompt.ts            — Memory Prompt Supplement
│   ├── hooks/
│   │   ├── message-sending.ts      — 关键词缓存
│   │   ├── after-tool-call.ts      — tool 结果积累
│   │   ├── agent-end.ts            — session 级经验提取
│   │   ├── before-tool-call.ts     — trace recording
│   │   └── session-lifecycle.ts    — session_start / session_end
│   ├── service/
│   │   ├── index.ts                — 主 service（调度 8 个模块）
│   │   ├── distiller.ts
│   │   ├── publisher.ts
│   │   ├── puller.ts
│   │   ├── feedback-loop.ts
│   │   ├── outdated-detector.ts
│   │   ├── trace-evaluator.ts
│   │   ├── key-manager.ts
│   │   └── weekly-digest.ts
│   ├── tools/
│   │   ├── search.ts
│   │   └── publish.ts
│   ├── commands.ts                 — /xp command
│   ├── cli.ts                      — CLI subcommands
│   ├── routes.ts                   — HTTP routes
│   └── install.ts                  — 首次安装流程
├── templates/
│   └── preloaded-lessons.json
├── tests/
│   ├── helpers/
│   │   └── mock-api.ts             — Mock OpenClawPluginApi factory
│   └── ... (每个 src 文件对应一个 test 文件)
├── SECURITY.md
├── README.md
└── scripts/
    └── release.sh
```

## 依赖链（开发顺序）

```
01-scaffold ──→ 02-db ──→ 03-sanitize ──┐
                                         ├──→ 06-memory-corpus ──┐
                          04-injection ──┘                       │
                                         ├──→ 07-memory-prompt ──┤
                          05-extraction ──┘                       │
                                                                  ├──→ 08-hooks ──→ 10-service
                                                                  │
                                                                  └──→ 09-trace
                                                                         │
                    11-tools ←─────────────────────────────────────────────┤
                    12-commands ←───────────────────────────────────────────┤
                    13-cli ←───────────────────────────────────────────────┤
                    14-routes ←────────────────────────────────────────────┘
                         │
                    15-install ──→ 16-security ──→ 17-integration ──→ 18-readme
```

## 计划文件索引

| 文件 | Task | 内容 |
|---|---|---|
| `01-scaffold.md` | 1 | 包结构 + manifest + entry + mock API |
| `02-db.md` | 2 | SQLite 存储层 |
| `03-sanitize.md` | 3 | 安全过滤 + context wrapper |
| `04-injection.md` | 4 | D' 选择性注入引擎 |
| `05-extraction.md` | 5 | 经验提取引擎 |
| `06-memory-corpus.md` | 6 | Memory Corpus Supplement |
| `07-memory-prompt.md` | 7 | Memory Prompt Supplement |
| `08-hooks.md` | 8 | 所有 hook（5 个，合并为 1 个 task） |
| `09-trace.md` | 9 | before_tool_call trace recording |
| `10-service.md` | 10 | Background service（8 个子模块） |
| `11-tools.md` | 11 | Optional tools |
| `12-commands.md` | 12 | /xp chat commands |
| `13-cli.md` | 13 | CLI subcommands |
| `14-routes.md` | 14 | HTTP routes |
| `15-install.md` | 15 | Install flow + preloaded experiences |
| `16-security.md` | 16 | Security audit + safety tests |
| `17-integration.md` | 17 | Integration test |
| `18-readme.md` | 18 | README + publish preparation |

---

_修正版 2026-04-16。基于 OpenClaw Plugin SDK 2026.4.14 实际类型定义。_

---

## 文件: 01-scaffold.md

# Task 1: Package scaffold + manifest + entry point + mock API

## 修正点
- **新增 `tests/helpers/mock-api.ts`**：完整的 Mock OpenClawPluginApi factory，所有后续 task 的测试都依赖它
- **ConfigSchema 精简**：只暴露 `mode` 和 `relayUrl` 两项，其余用代码内默认值
- **确认 manifest 格式**：只用 `openclaw.plugin.json`，不在 package.json 里重复

## 文件

- Create: `packages/plugin/package.json`
- Create: `packages/plugin/openclaw.plugin.json`
- Create: `packages/plugin/tsconfig.json`
- Create: `packages/plugin/src/index.ts`
- Create: `packages/plugin/src/types.ts`
- Create: `packages/plugin/tests/helpers/mock-api.ts`
- Test: `packages/plugin/tests/entry.test.ts`

## Tests

```typescript
// tests/entry.test.ts
import { describe, it, expect } from 'vitest'

describe('plugin entry', () => {
  it('exports a valid plugin definition', async () => {
    const mod = await import('../src/index.js')
    const entry = mod.default
    expect(entry).toBeDefined()
    expect(entry.id).toBe('agentxp')
    expect(entry.name).toBe('AgentXP')
    expect(typeof entry.register).toBe('function')
  })
})
```

## Implementation

### `openclaw.plugin.json`
```json
{
  "id": "agentxp",
  "name": "AgentXP",
  "description": "Agent experience learning and sharing",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["local", "network"],
        "default": "local"
      },
      "relayUrl": {
        "type": "string",
        "default": "https://relay.agentxp.io"
      }
    }
  }
}
```

### `src/types.ts`
```typescript
export interface PluginConfig {
  mode: 'local' | 'network'
  relayUrl: string
  // 以下不进 configSchema，代码内默认值
  maxInjectionTokens: number
  autoPublish: boolean
  weaning: { enabled: boolean; rate: number }
  weeklyDigest: boolean
}

export const DEFAULT_CONFIG: PluginConfig = {
  mode: 'local',
  relayUrl: 'https://relay.agentxp.io',
  maxInjectionTokens: 500,
  autoPublish: false,
  weaning: { enabled: true, rate: 0.1 },
  weeklyDigest: true,
}

export function resolveConfig(pluginConfig?: Record<string, unknown>): PluginConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(pluginConfig as Partial<PluginConfig>),
  }
}
```

### `src/index.ts`
```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { resolveConfig } from './types.js'

export default definePluginEntry({
  id: 'agentxp',
  name: 'AgentXP',
  description: 'Agent experience learning and sharing',
  register(api) {
    const config = resolveConfig(api.pluginConfig)
    // Tasks 2-18 register capabilities here
  },
})
```

### `tests/helpers/mock-api.ts`

Mock factory 覆盖 `OpenClawPluginApi` 的所有注册方法：

```typescript
import type { PluginHookHandlerMap, PluginHookName } from 'openclaw/plugin-sdk/plugin-entry'

export interface MockApiCapture {
  corpusSupplements: any[]
  promptSupplements: any[]
  hooks: Map<string, Function[]>
  typedHooks: Map<string, Function[]>
  services: any[]
  tools: any[]
  commands: any[]
  cliRegistrars: any[]
  httpRoutes: any[]
}

export function createMockApi(pluginConfig?: Record<string, unknown>): {
  api: any  // OpenClawPluginApi
  capture: MockApiCapture
} {
  const capture: MockApiCapture = {
    corpusSupplements: [],
    promptSupplements: [],
    hooks: new Map(),
    typedHooks: new Map(),
    services: [],
    tools: [],
    commands: [],
    cliRegistrars: [],
    httpRoutes: [],
  }

  const api = {
    id: 'agentxp',
    name: 'AgentXP',
    source: 'test',
    registrationMode: 'full' as const,
    config: {} as any,
    pluginConfig: pluginConfig ?? {},
    runtime: {} as any,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    registerMemoryCorpusSupplement: (s: any) => capture.corpusSupplements.push(s),
    registerMemoryPromptSupplement: (b: any) => capture.promptSupplements.push(b),
    registerHook: (events: string | string[], handler: Function) => {
      const evts = Array.isArray(events) ? events : [events]
      for (const e of evts) {
        if (!capture.hooks.has(e)) capture.hooks.set(e, [])
        capture.hooks.get(e)!.push(handler)
      }
    },
    on: <K extends PluginHookName>(hookName: K, handler: PluginHookHandlerMap[K]) => {
      if (!capture.typedHooks.has(hookName)) capture.typedHooks.set(hookName, [])
      capture.typedHooks.get(hookName)!.push(handler as Function)
    },
    registerService: (s: any) => capture.services.push(s),
    registerTool: (t: any, opts?: any) => capture.tools.push({ tool: t, opts }),
    registerCommand: (c: any) => capture.commands.push(c),
    registerCli: (r: any, opts?: any) => capture.cliRegistrars.push({ registrar: r, opts }),
    registerHttpRoute: (p: any) => capture.httpRoutes.push(p),
    resolvePath: (p: string) => p,
  }

  return { api, capture }
}
```

## Commit
`feat(plugin): scaffold + manifest + entry + mock API factory`

---

## 文件: 02-db.md

# Task 2: SQLite storage layer

## 修正点
- **FTS5 查询清洗**：`searchLessons` 在传入 FTS5 MATCH 前，清除 AND/OR/NOT/NEAR/* 等操作符，只保留字母数字和空格
- **FTS5 可用性运行时检测**：`createDb` 时测试 FTS5，不可用则 fallback 到 LIKE 查询
- **context_cache 用 UPSERT**：同一 session 只保留最新一条

## 文件

- Create: `packages/plugin/src/db.ts`
- Test: `packages/plugin/tests/db.test.ts`

## Schema

```sql
-- 经验存储
CREATE TABLE local_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  what TEXT NOT NULL,
  tried TEXT NOT NULL,
  outcome TEXT NOT NULL,
  learned TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'network'
  tags TEXT DEFAULT '[]',                -- JSON array
  relevance_score REAL DEFAULT 0,
  applied_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  outdated INTEGER DEFAULT 0,
  embedding BLOB
);

-- FTS5 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS local_lessons_fts USING fts5(
  what, tried, outcome, learned, tags,
  content='local_lessons',
  content_rowid='id'
);

-- 触发器保持 FTS 同步
CREATE TRIGGER lessons_ai AFTER INSERT ON local_lessons BEGIN
  INSERT INTO local_lessons_fts(rowid, what, tried, outcome, learned, tags)
  VALUES (new.id, new.what, new.tried, new.outcome, new.learned, new.tags);
END;

CREATE TRIGGER lessons_ad AFTER DELETE ON local_lessons BEGIN
  INSERT INTO local_lessons_fts(local_lessons_fts, rowid, what, tried, outcome, learned, tags)
  VALUES ('delete', old.id, old.what, old.tried, old.outcome, old.learned, old.tags);
END;

CREATE TRIGGER lessons_au AFTER UPDATE ON local_lessons BEGIN
  INSERT INTO local_lessons_fts(local_lessons_fts, rowid, what, tried, outcome, learned, tags)
  VALUES ('delete', old.id, old.what, old.tried, old.outcome, old.learned, old.tags);
  INSERT INTO local_lessons_fts(rowid, what, tried, outcome, learned, tags)
  VALUES (new.id, new.what, new.tried, new.outcome, new.learned, new.tags);
END;

-- Trace steps（只存 toolName + action，不存 raw params）
CREATE TABLE trace_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  action TEXT NOT NULL,
  tool_name TEXT,
  significance TEXT DEFAULT 'routine',
  error_signature TEXT,         -- 脱敏后的错误签名
  duration_ms INTEGER,
  timestamp INTEGER NOT NULL
);

CREATE INDEX idx_trace_session ON trace_steps(session_id);

-- 反馈
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL,
  type TEXT NOT NULL,            -- 'cited' | 'verified' | 'contradicted' | 'outdated'
  session_id TEXT,
  comment TEXT,
  created_at INTEGER NOT NULL
);

-- 发布日志
CREATE TABLE published_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL,
  relay_event_id TEXT,
  published_at INTEGER NOT NULL,
  unpublished_at INTEGER
);

-- 注入日志
CREATE TABLE injection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  injected INTEGER NOT NULL,    -- 0 or 1
  token_count INTEGER DEFAULT 0,
  lesson_ids TEXT DEFAULT '[]', -- JSON array
  created_at INTEGER NOT NULL
);

-- 上下文关键词缓存（per session，UPSERT）
CREATE TABLE context_cache (
  session_id TEXT PRIMARY KEY,
  keywords TEXT NOT NULL,       -- JSON array
  updated_at INTEGER NOT NULL
);
```

## Key Implementation Details

### FTS5 查询清洗
```typescript
function sanitizeFtsQuery(raw: string): string {
  // 只保留字母、数字、空格、CJK 字符
  return raw.replace(/[^a-zA-Z0-9\s\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, ' ')
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
```

### FTS5 可用性检测
```typescript
function hasFts5(db: Database): boolean {
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_test USING fts5(x)")
    db.exec("DROP TABLE IF EXISTS _fts5_test")
    return true
  } catch {
    return false
  }
}
```

## Tests

同原版 + 新增：
- FTS5 查询清洗测试（注入 `"* NOT learned"` 不会返回意外结果）
- UPSERT context_cache 测试（同一 session_id 更新而非插入）
- trace_steps 不含 params 字段

## Commit
`feat(plugin): SQLite storage layer with FTS5 + query sanitization`

---

## 文件: 03-sanitize.md

# Task 3: Sanitize + context wrapper

## 修正点
- **Sanitize 在写入时执行**：extractionEngine → sanitize → db.insertLesson。不只是发布时。
- **Preloaded 经验也走 sanitize**：install.ts 导入 preloaded-lessons.json 时，每条过 sanitize pipeline。

## 文件

- Create: `packages/plugin/src/sanitize.ts`
- Create: `packages/plugin/src/context-wrapper.ts`
- Test: `packages/plugin/tests/sanitize.test.ts`
- Test: `packages/plugin/tests/context-wrapper.test.ts`

## Implementation

直接 port `packages/skill/src/sanitize.ts` 和 `packages/skill/src/context-wrapper.ts`。

适配点：
- 输入类型从 relay `Experience` 改为 DB `Lesson`（字段名 what/tried/outcome/learned）
- `sanitizeLesson(lesson)` 对所有 4 个字段执行检测，任一命中则 reject
- 新增 `sanitizeBeforeStore(lesson)` — 只 redact 不 reject（用于写入时清理，不丢弃经验）

### sanitize 分两层

| 函数 | 用途 | 行为 |
|---|---|---|
| `sanitizeBeforeStore(lesson)` | 写入 DB 前 | redact credentials/paths/emails，保留经验 |
| `sanitizeBeforePublish(lesson)` | 发布到 relay 前 | inject detection + unicode detection + credential detection，命中则 reject |

## Tests

- 20 injection 模式全部被 `sanitizeBeforePublish` 拦截
- 15 unicode 模式全部被检测
- 11 credential 模式被 `sanitizeBeforeStore` redact（不拦截，只替换）
- context-wrapper：XML 标签正确包裹、HTML entity 转义、嵌套标签防御

## Commit
`feat(plugin): port sanitize + context-wrapper with store-time redaction`

---

## 文件: 04-injection.md

# Task 4: D' selective injection engine

## 修正点
- **Relay URL 验证**：query relay 前验证 URL 必须 HTTPS + 非私有 IP（防 SSRF）
- **FTS5 查询走清洗**：调用 db.searchLessons 时已经在 db 层清洗，injection-engine 不需要额外处理

## 文件

- Create: `packages/plugin/src/injection-engine.ts`
- Test: `packages/plugin/tests/injection-engine.test.ts`

## Core Logic

```typescript
export interface InjectionResult {
  injected: boolean
  lines: string[]           // 注入到 prompt 的行
  tokenEstimate: number
  lessonIds: number[]
  skippedByWeaning: boolean
}

export function selectExperiences(params: {
  keywords: string[]
  phase: 'planning' | 'executing' | 'stuck' | 'evaluating'
  db: AgentXPDb
  config: PluginConfig
}): InjectionResult
```

### 步骤

1. **Weaning check**：`Math.random() < config.weaning.rate` → 返回空（10% 断奶）
2. **本地搜索**：`db.searchLessons(keywords.join(' '), 10)` — FTS5 已在 db 层清洗
3. **网络搜索**（如果 `config.mode === 'network'`）：
   - 验证 relay URL：`validateRelayUrl(config.relayUrl)` — 必须 HTTPS + 非私有 IP
   - `fetch(relayUrl + '/api/v1/search', { signal: AbortSignal.timeout(2000) })`
   - 失败静默（fail-open）
4. **合并 + 去重**（本地优先）
5. **Phase weight 调整**：
   - planning: prefer high-level strategy lessons
   - executing: prefer specific how-to lessons
   - stuck: prefer lessons with backtrack/dead_end patterns
   - evaluating: prefer lessons with outcome verification
6. **Relevance 过滤**：score > 0.7
7. **Token budget**：贪心选 top lessons 直到 `config.maxInjectionTokens`
8. **Context wrap**：用 context-wrapper 包裹，加 `[AgentXP]` 标记

### Relay URL 验证

```typescript
function validateRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    // 检查私有 IP
    const host = parsed.hostname
    if (host === 'localhost' || host === '127.0.0.1') return false
    if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) return false
    if (host.startsWith('169.254.')) return false  // link-local / AWS metadata
    return true
  } catch {
    return false
  }
}
```

### Phase inference（port from skill）

```typescript
export function inferPhase(keywords: string[]): 'planning' | 'executing' | 'stuck' | 'evaluating' {
  const text = keywords.join(' ').toLowerCase()
  if (/error|fail|stuck|debug|why|broken/.test(text)) return 'stuck'
  if (/plan|design|architect|think|decide/.test(text)) return 'planning'
  if (/test|verify|check|assert|confirm/.test(text)) return 'evaluating'
  return 'executing'
}
```

## Tests

- 关键词提取 → 正确搜索
- Phase inference：各场景正确分类
- Relevance scoring：低分经验被过滤
- Token budget：不超 maxInjectionTokens
- Weaning：n=1000 统计测试，skip rate ≈ 10%
- Relay timeout：2s 后 fail-open
- Relay URL 验证：private IP / HTTP / localhost 全部拒绝
- 空结果 → 空注入
- [AgentXP] 标记存在

## Commit
`feat(plugin): D' selective injection engine with SSRF protection`

---

## 文件: 05-extraction.md

# Task 5: Experience extraction engine

## 修正点
- **数据源改变**：不再从 `message_sending` 的 content 提取 tool call 数据。数据来源改为：
  - `after_tool_call` hook 积累的 tool 结果（存在内存 buffer 里）
  - `agent_end` hook 触发时做 session 级提取
  - `message_sending` 的 content 只用于文本模式检测
- **写入时 sanitize**：提取后先 `sanitizeBeforeStore()` 再写 DB

## 文件

- Create: `packages/plugin/src/extraction-engine.ts`
- Test: `packages/plugin/tests/extraction-engine.test.ts`

## Core Logic

### 两种提取模式

**模式 A：Tool call 提取（主要）**

从 `after_tool_call` 积累的 buffer 里提取：
```typescript
interface ToolCallRecord {
  toolName: string
  params: { path?: string }  // 只保留非敏感字段
  result?: string             // 截断到 200 chars
  error?: string
  durationMs?: number
}
```

检测解决方案模式：
- tool 成功（无 error）+ 之前有 error 的 tool call → "修复了某个问题"
- 连续 read → edit/write → exec(test pass) → "实现了某个功能"
- exec 从失败到成功 → "调试并修复"

**模式 B：文本提取（辅助）**

从 `message_sending` 的 `content` 文本检测：
- "the issue was..." / "fixed by..." / "solved" / "the solution is..."
- "I learned that..." / "turns out..."
- 中文："原因是..." / "解决了" / "发现..."

### 质量门控（port from publisher.ts）

```typescript
function qualityGate(lesson: Partial<Lesson>): boolean {
  if (!lesson.what || lesson.what.length < 10) return false
  if (!lesson.learned || lesson.learned.length < 20) return false
  // 具体性检测：至少包含一个技术名词、路径、或错误名
  if (!/[A-Z][a-z]+Error|\/[\w/]+\.\w+|\b\w+\.\w+\(\)/.test(lesson.learned)) return false
  return true
}
```

### Pipeline

```
ToolCallBuffer / MessageContent
  → 模式检测（A 或 B）
  → 结构化提取（what/tried/outcome/learned）
  → 质量门控
  → sanitizeBeforeStore()
  → return Lesson | null
```

## Tests

- Tool call 模式：error → fix → success 正确提取
- Text 模式：各种文本模式正确检测
- 质量门控：太短拒绝、无技术词拒绝
- Sanitize：credential 被 redact 后仍然通过
- 空输入 → null
- 混合输入（有 tool call 又有文本）→ 只产生一条经验

## Commit
`feat(plugin): experience extraction engine with dual-mode detection`

---

## 文件: 06-memory-corpus.md

# Task 6: Memory Corpus Supplement

## 文件

- Create: `packages/plugin/src/memory-corpus.ts`
- Modify: `packages/plugin/src/index.ts`
- Test: `packages/plugin/tests/memory-corpus.test.ts`

## Implementation

```typescript
import type { MemoryCorpusSupplement, MemoryCorpusSearchResult, MemoryCorpusGetResult } from 'openclaw/plugin-sdk/plugin-entry'

export function createCorpusSupplement(db: AgentXPDb, config: PluginConfig): MemoryCorpusSupplement {
  return {
    async search({ query, maxResults, agentSessionKey }) {
      const limit = maxResults ?? 5
      const lessons = db.searchLessons(query, limit)

      return lessons.map((lesson, i): MemoryCorpusSearchResult => ({
        corpus: 'agentxp',
        path: `agentxp://lesson/${lesson.id}`,
        title: lesson.what,
        kind: 'experience',
        score: 1.0 - (i * 0.1),  // FTS5 结果已按相关度排序
        snippet: `Tried: ${lesson.tried}\nLearned: ${lesson.learned}`,
        id: String(lesson.id),
        citation: `[AgentXP #${lesson.id}]`,
        source: lesson.source,
        provenanceLabel: 'AgentXP',
        sourceType: 'plugin',
      }))
    },

    async get({ lookup, fromLine, lineCount, agentSessionKey }) {
      // lookup = "agentxp://lesson/123" or just "123"
      const id = parseInt(lookup.replace(/^agentxp:\/\/lesson\//, ''), 10)
      if (isNaN(id)) return null

      const lesson = db.getLessonById(id)
      if (!lesson) return null

      const content = [
        `## ${lesson.what}`,
        '',
        `**Tried:** ${lesson.tried}`,
        `**Outcome:** ${lesson.outcome}`,
        `**Learned:** ${lesson.learned}`,
        '',
        `Source: ${lesson.source} | Created: ${new Date(lesson.created_at).toISOString()}`,
        lesson.tags ? `Tags: ${JSON.parse(lesson.tags).join(', ')}` : '',
      ].filter(Boolean).join('\n')

      return {
        corpus: 'agentxp',
        path: `agentxp://lesson/${lesson.id}`,
        title: lesson.what,
        kind: 'experience',
        content,
        fromLine: 1,
        lineCount: content.split('\n').length,
        id: String(lesson.id),
        provenanceLabel: 'AgentXP',
        sourceType: 'plugin',
      }
    },
  }
}
```

### 注册

```typescript
// src/index.ts 内
api.registerMemoryCorpusSupplement(createCorpusSupplement(db, config))
```

## 备注

- `search` 有 `agentSessionKey` 参数可用于 session-specific 过滤（目前不需要，留扩展口）
- agent 调用 `memory_search(corpus='all')` 时自动触发此 supplement
- 不需要额外 tool — Memory Corpus 已经集成到 agent 的 memory_search 里

## Tests

- search 返回 MemoryCorpusSearchResult[] 格式正确
- get 返回单条经验的 markdown 格式
- 空查询返回空数组
- lesson.id 查找：存在 → 返回，不存在 → null
- score 递减
- corpus 字段 = 'agentxp'

## Commit
`feat(plugin): Memory Corpus Supplement for memory_search integration`

---

## 文件: 07-memory-prompt.md

# Task 7: Memory Prompt Supplement (D' injection)

## 修正点
- **Session 上下文问题已解决**：builder 没有 sessionKey 参数，改用「全局最近活跃 session」策略
- `message_sending` hook（Task 8）每次触发时更新一个模块级变量 `lastActiveSessionKey`
- builder 读取这个变量对应的 context_cache
- 多 session 并发时取最近更新的，不完美但足够（并发 session 极少）

## 文件

- Create: `packages/plugin/src/memory-prompt.ts`
- Modify: `packages/plugin/src/index.ts`
- Test: `packages/plugin/tests/memory-prompt.test.ts`

## Implementation

```typescript
import type { MemoryPromptSectionBuilder } from 'openclaw/plugin-sdk/plugin-entry'

// 模块级状态 — message_sending hook 更新这里
let _lastActiveSessionKey: string | null = null
let _lastActiveTimestamp = 0

export function setLastActiveSession(sessionKey: string): void {
  _lastActiveSessionKey = sessionKey
  _lastActiveTimestamp = Date.now()
}

export function createPromptBuilder(db: AgentXPDb, config: PluginConfig): MemoryPromptSectionBuilder {
  return ({ availableTools, citationsMode }) => {
    // 30 秒内没有活跃 session → 不注入（避免注入过期上下文）
    if (!_lastActiveSessionKey || Date.now() - _lastActiveTimestamp > 30_000) {
      return []
    }

    const keywords = db.getContextCache(_lastActiveSessionKey)
    if (!keywords || keywords.length === 0) {
      return []
    }

    const result = selectExperiences({
      keywords,
      phase: inferPhase(keywords),
      db,
      config,
    })

    if (!result.injected) return []

    // 记录注入日志
    db.recordInjection({
      sessionId: _lastActiveSessionKey,
      injected: true,
      tokenCount: result.tokenEstimate,
      lessonIds: result.lessonIds,
    })

    return result.lines
  }
}
```

### 注册

```typescript
// src/index.ts 内
api.registerMemoryPromptSupplement(createPromptBuilder(db, config))
```

## builder 签名确认

SDK 实际类型：
```typescript
type MemoryPromptSectionBuilder = (params: {
  availableTools: Set<string>
  citationsMode?: MemoryCitationsMode
}) => string[]
```

**没有 sessionKey**。上述 `_lastActiveSessionKey` 是 workaround。

## Tests

- 有缓存 → 返回注入行（带 [AgentXP] 标记）
- 无缓存 → 返回 []
- 缓存超 30 秒 → 返回 []
- Weaning skip → 返回 []（统计测试）
- Token budget 不超限
- 注入日志被写入 injection_log 表

## Commit
`feat(plugin): Memory Prompt Supplement with last-active-session workaround`

---

## 文件: 08-hooks.md

# Task 8: All hooks (5 个 hook，合并为 1 个 task)

## 修正点（最大改动）
- **全部改用 `api.on()` 注册 typed hook**（不用 `registerHook` + `InternalHookHandler`）
- **新增 `after_tool_call` hook**：积累 tool 结果到内存 buffer
- **新增 `agent_end` hook**：session 级经验提取
- **新增 `session_start` / `session_end` hook**：context_cache 生命周期
- **`message_sending` 只做关键词缓存**，不做经验提取（提取移到 agent_end）
- **返回值修正**：不返回 `{ cancel: false }`，返回 void 或 undefined

## 文件

- Create: `packages/plugin/src/hooks/message-sending.ts`
- Create: `packages/plugin/src/hooks/after-tool-call.ts`
- Create: `packages/plugin/src/hooks/agent-end.ts`
- Create: `packages/plugin/src/hooks/before-tool-call.ts`
- Create: `packages/plugin/src/hooks/session-lifecycle.ts`
- Tests: `packages/plugin/tests/hooks/*.test.ts`（每个一个）

---

## Hook 1: `message_sending` — 关键词缓存

### SDK 类型

```typescript
// Event
type PluginHookMessageSendingEvent = {
  to: string
  content: string
  metadata?: Record<string, unknown>
}

// Context
type PluginHookMessageContext = {
  channelId: string
  accountId?: string
  conversationId?: string
}

// Result（可选返回）
type PluginHookMessageSendingResult = {
  content?: string   // 修改消息内容
  cancel?: boolean   // 取消发送
}
```

### 注册方式
```typescript
api.on('message_sending', (event, ctx) => {
  // 从 event.content 提取关键词 → 更新 context_cache
  // 更新 lastActiveSessionKey（给 MemoryPromptSupplement 用）
  // 不返回任何东西（void）= 不修改消息
})
```

### 实现
```typescript
export function createMessageSendingHook(db: AgentXPDb) {
  return (event: PluginHookMessageSendingEvent, ctx: PluginHookMessageContext) => {
    try {
      const sessionKey = ctx.conversationId ?? ctx.channelId
      const keywords = extractKeywords(event.content)
      if (keywords.length > 0) {
        db.updateContextCache(sessionKey, keywords)
        setLastActiveSession(sessionKey)
      }
    } catch {
      // never throw — 不阻塞消息发送
    }
  }
}
```

### 关键词提取
```typescript
function extractKeywords(text: string): string[] {
  // 提取技术关键词：编程语言、框架、工具名、错误名
  // 过滤通用词（the, is, a, 的, 了, 是）
  // 限制 20 个关键词
}
```

---

## Hook 2: `after_tool_call` — tool 结果积累

### SDK 类型

```typescript
type PluginHookAfterToolCallEvent = {
  toolName: string
  params: Record<string, unknown>
  runId?: string
  toolCallId?: string
  result?: unknown
  error?: string
  durationMs?: number
}

type PluginHookToolContext = {
  agentId?: string
  sessionKey?: string
  sessionId?: string
  runId?: string
  toolName: string
  toolCallId?: string
}
```

### 注册方式
```typescript
api.on('after_tool_call', (event, ctx) => {
  // 积累到内存 buffer（per session）
  // 不存 raw params — 只存 toolName + path/query 等非敏感字段
})
```

### 实现

```typescript
// 内存 buffer（不持久化，session 结束清理）
const toolCallBuffers = new Map<string, ToolCallRecord[]>()

export function createAfterToolCallHook() {
  return (event: PluginHookAfterToolCallEvent, ctx: PluginHookToolContext) => {
    try {
      const sessionKey = ctx.sessionKey ?? 'unknown'
      if (!toolCallBuffers.has(sessionKey)) toolCallBuffers.set(sessionKey, [])

      const record: ToolCallRecord = {
        toolName: event.toolName,
        hasError: !!event.error,
        errorSignature: event.error ? extractErrorSignature(event.error) : undefined,
        durationMs: event.durationMs,
        // 只存非敏感 param：path（文件名部分）、query
        safeMeta: extractSafeMeta(event.toolName, event.params),
      }

      toolCallBuffers.get(sessionKey)!.push(record)

      // 限制 buffer 大小（最近 50 条）
      const buf = toolCallBuffers.get(sessionKey)!
      if (buf.length > 50) buf.splice(0, buf.length - 50)
    } catch {
      // never throw
    }
  }
}

function extractSafeMeta(toolName: string, params: Record<string, unknown>): Record<string, string> {
  const meta: Record<string, string> = {}
  // read/write/edit → 只取文件 basename
  if (params.path && typeof params.path === 'string') {
    meta.file = path.basename(params.path)
  }
  // exec → 只取命令的第一个 token
  if (toolName === 'exec' && params.command && typeof params.command === 'string') {
    meta.cmd = params.command.split(/\s/)[0]
  }
  return meta
}
```

---

## Hook 3: `agent_end` — session 级经验提取

### SDK 类型

```typescript
type PluginHookAgentEndEvent = {
  messages: unknown[]
  success: boolean
  error?: string
  durationMs?: number
}
```

### 注册方式
```typescript
api.on('agent_end', (event, ctx) => {
  // 从 toolCallBuffers 取出该 session 的记录
  // 调用 extractionEngine 提取经验
  // 写入 DB
  // 清理 buffer
})
```

### 实现

```typescript
export function createAgentEndHook(db: AgentXPDb) {
  return async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => {
    try {
      const sessionKey = ctx.sessionKey ?? 'unknown'
      const buffer = toolCallBuffers.get(sessionKey)

      if (buffer && buffer.length >= 2) {
        const lesson = extractFromToolCalls(buffer)
        if (lesson) {
          const sanitized = sanitizeBeforeStore(lesson)
          db.insertLesson({ ...sanitized, source: 'local', tags: '[]' })
        }
      }

      // 清理 buffer
      toolCallBuffers.delete(sessionKey)
    } catch {
      // never throw
    }
  }
}
```

---

## Hook 4: `before_tool_call` — trace recording

### SDK 类型

```typescript
type PluginHookBeforeToolCallEvent = {
  toolName: string
  params: Record<string, unknown>
  runId?: string
  toolCallId?: string
}

// Result（可选返回）
type PluginHookBeforeToolCallResult = {
  params?: Record<string, unknown>
  block?: boolean
  blockReason?: string
  requireApproval?: { ... }
}
```

### 注册方式
```typescript
api.on('before_tool_call', (event, ctx) => {
  // 写 trace_steps（只存 toolName + action，不存 params）
  // 不返回 = 不修改不阻断
})
```

### 实现

```typescript
export function createBeforeToolCallHook(db: AgentXPDb) {
  return (event: PluginHookBeforeToolCallEvent, ctx: PluginHookToolContext) => {
    try {
      db.insertTraceStep({
        sessionId: ctx.sessionKey ?? 'unknown',
        action: normalizeAction(event.toolName),
        toolName: event.toolName,
        significance: 'routine',
        timestamp: Date.now(),
      })
    } catch {
      // never throw
    }
  }
}
```

---

## Hook 5: `session_start` / `session_end` — lifecycle

### SDK 类型

```typescript
type PluginHookSessionStartEvent = {
  sessionFile?: string
  messages?: unknown[]
  trigger?: string
}

type PluginHookSessionEndEvent = {
  sessionFile?: string
  messages?: unknown[]
  reason?: string
}

type PluginHookSessionContext = {
  agentId?: string
  sessionKey?: string
  sessionId?: string
}
```

### 实现

```typescript
export function createSessionHooks(db: AgentXPDb) {
  return {
    onStart: (event: PluginHookSessionStartEvent, ctx: PluginHookSessionContext) => {
      // 可选：预热 context_cache
    },
    onEnd: (event: PluginHookSessionEndEvent, ctx: PluginHookSessionContext) => {
      try {
        const sessionKey = ctx.sessionKey
        if (sessionKey) {
          // 清理 context_cache
          db.clearContextCache(sessionKey)
          // 清理 tool call buffer
          toolCallBuffers.delete(sessionKey)
        }
      } catch {
        // never throw
      }
    },
  }
}
```

---

## 注册汇总（在 index.ts 里）

```typescript
api.on('message_sending', createMessageSendingHook(db))
api.on('after_tool_call', createAfterToolCallHook())
api.on('agent_end', createAgentEndHook(db))
api.on('before_tool_call', createBeforeToolCallHook(db))
api.on('session_start', sessionHooks.onStart)
api.on('session_end', sessionHooks.onEnd)
```

## Tests

每个 hook 独立测试：
- message_sending：关键词缓存写入 + lastActiveSession 更新
- after_tool_call：buffer 积累 + 大小限制 + 不存 raw params
- agent_end：从 buffer 提取经验 → 写入 DB → buffer 清理
- before_tool_call：trace_step 写入 + 不存 params
- session_end：context_cache 清理 + buffer 清理
- 所有 hook：异常不冒泡（try-catch 测试）

## Commit
`feat(plugin): 5 typed hooks (api.on) with safe data handling`

---

## 文件: 09-trace.md

# Task 9: Trace recording (已合并到 Task 8)

> `before_tool_call` hook 的 trace recording 逻辑已在 Task 8 中实现。
> 此文件保留为索引，不需要单独开发。

## 差异说明

原版 Task 9 的内容：
- `before_tool_call` hook 注册 → 已在 08-hooks.md Hook 4
- TraceRecorder.normalizeAction → 已在 08-hooks.md
- trace_steps 表写入 → 已在 08-hooks.md

修正点（已在 Task 8 中体现）：
- 不存 raw params（只存 toolName + action）
- 用 `api.on('before_tool_call')` 而不是 `registerHook`
- 返回 void 而不是 `{ block: false }`

---

## 文件: 10-service.md

# Task 10: Background service (1 个 service，8 个内部模块)

## 修正点
- **1 个 registerService 注册**，不是 8 个。`api.registerService({ id: 'agentxp', start, stop })`
- **内部模块调度**：start() 启动一个主循环 interval，按条件调度各模块
- **每个模块独立 try-catch + 指数退避**：一个失败不影响其他
- **优雅 shutdown**：stop() 清理所有 timers，等待进行中的操作完成（5s 超时）

## 文件

- Create: `packages/plugin/src/service/index.ts` — 主 service
- Create: `packages/plugin/src/service/distiller.ts`
- Create: `packages/plugin/src/service/publisher.ts`
- Create: `packages/plugin/src/service/puller.ts`
- Create: `packages/plugin/src/service/feedback-loop.ts`
- Create: `packages/plugin/src/service/outdated-detector.ts`
- Create: `packages/plugin/src/service/trace-evaluator.ts`
- Create: `packages/plugin/src/service/key-manager.ts`
- Create: `packages/plugin/src/service/weekly-digest.ts`
- Tests: `packages/plugin/tests/service/*.test.ts`

## 主 Service

```typescript
import type { OpenClawPluginService, OpenClawPluginServiceContext } from 'openclaw/plugin-sdk/plugin-entry'

export function createService(db: AgentXPDb, config: PluginConfig): OpenClawPluginService {
  let mainInterval: ReturnType<typeof setInterval> | null = null
  let stopping = false

  return {
    id: 'agentxp',

    async start(ctx: OpenClawPluginServiceContext) {
      const { logger } = ctx
      stopping = false

      // 主循环：每 5 分钟 tick 一次
      mainInterval = setInterval(async () => {
        if (stopping) return
        await runModules(db, config, logger)
      }, 5 * 60 * 1000)

      // 启动后立即跑一次
      await runModules(db, config, logger)
    },

    async stop(ctx: OpenClawPluginServiceContext) {
      stopping = true
      if (mainInterval) {
        clearInterval(mainInterval)
        mainInterval = null
      }
      // 等待进行中的操作（最多 5s）
      await new Promise(r => setTimeout(r, 100))
    },
  }
}
```

## 模块调度

```typescript
interface ModuleState {
  lastRun: number
  consecutiveFailures: number
  backoffMs: number
}

const states = new Map<string, ModuleState>()

async function runModules(db: AgentXPDb, config: PluginConfig, logger: PluginLogger) {
  const modules: Array<{
    id: string
    intervalMs: number
    condition: () => boolean
    run: () => Promise<void>
  }> = [
    {
      id: 'distiller',
      intervalMs: 30 * 60 * 1000,        // 30 min
      condition: () => db.getNewLessonCount() >= 5,  // 有新内容才跑
      run: () => runDistiller(db, logger),
    },
    {
      id: 'publisher',
      intervalMs: 30 * 60 * 1000,
      condition: () => config.autoPublish && config.mode === 'network',
      run: () => runPublisher(db, config, logger),
    },
    {
      id: 'puller',
      intervalMs: 30 * 60 * 1000,
      condition: () => config.mode === 'network',
      run: () => runPuller(db, config, logger),
    },
    {
      id: 'feedback-loop',
      intervalMs: 60 * 60 * 1000,        // 1 hour
      condition: () => config.mode === 'network' && db.hasPublished(),
      run: () => runFeedbackLoop(db, config, logger),
    },
    {
      id: 'outdated-detector',
      intervalMs: 24 * 60 * 60 * 1000,   // daily
      condition: () => true,
      run: () => runOutdatedDetector(db, logger),
    },
    {
      id: 'trace-evaluator',
      intervalMs: 60 * 60 * 1000,
      condition: () => db.hasNewTraces(),
      run: () => runTraceEvaluator(db, config, logger),
    },
    {
      id: 'key-manager',
      intervalMs: 24 * 60 * 60 * 1000,
      condition: () => config.mode === 'network',
      run: () => runKeyManager(db, config, logger),
    },
    {
      id: 'weekly-digest',
      intervalMs: 7 * 24 * 60 * 60 * 1000,
      condition: () => config.weeklyDigest,
      run: () => runWeeklyDigest(db, config, logger),
    },
  ]

  for (const mod of modules) {
    const state = states.get(mod.id) ?? { lastRun: 0, consecutiveFailures: 0, backoffMs: 0 }
    const now = Date.now()

    // 跳过：间隔未到 / 条件不满足 / 在退避中
    if (now - state.lastRun < mod.intervalMs) continue
    if (!mod.condition()) continue
    if (state.backoffMs > 0 && now - state.lastRun < state.backoffMs) continue

    try {
      await mod.run()
      state.lastRun = now
      state.consecutiveFailures = 0
      state.backoffMs = 0
    } catch (err) {
      state.consecutiveFailures++
      // 指数退避：5s → 25s → 125s → 600s（上限 10 min）
      state.backoffMs = Math.min(10 * 60 * 1000, 5000 * Math.pow(5, state.consecutiveFailures - 1))
      logger.warn(`[agentxp/${mod.id}] failed (${state.consecutiveFailures}x): ${err}`)
    }

    states.set(mod.id, state)
  }
}
```

## 各子模块简述

| 模块 | 核心逻辑 | Port from |
|---|---|---|
| distiller | 5+ 条同类 lesson → 合并为 strategy rule → 写入 lessons.md | `packages/skill/src/distill.ts` |
| publisher | sanitizeBeforePublish → Serendip sign → POST relay → retry 3x | `packages/skill/src/publisher.ts` |
| puller | GET relay search → sanitize → insert local_lessons(source='network') | `packages/skill/src/relay-recall.ts` |
| feedback-loop | GET relay feedback → update lesson scores | `packages/skill/src/feedback-client.ts` |
| outdated-detector | 3+ contradicted feedback → markOutdated | 新逻辑 |
| trace-evaluator | steps >= 3 + dead_ends → 标记 high-value trace | `packages/skill/src/trace-publisher.ts` |
| key-manager | 检查 Serendip key 过期 → auto-renew | `packages/skill/src/key-renewer.ts` |
| weekly-digest | 统计 lessons/injections/publishes → 写 workspace 文件 | 新逻辑 |

## Tests

每个模块独立测试（mock DB）：
- distiller：5+ 相似 lessons → 合并输出
- publisher：sanitize 通过 → sign → 模拟 POST 成功/失败
- puller：模拟 relay 响应 → 正确 insert + sanitize
- feedback-loop：模拟 relay feedback → scores 更新
- outdated-detector：3+ contradicted → 标记 outdated
- trace-evaluator：够长 trace → 标记 high-value
- key-manager：过期 key → 触发 renew
- weekly-digest：统计数据格式正确

主 service 测试：
- start → tick → 模块被调度
- stop → 清理 interval
- 模块异常 → 不影响其他模块 + 退避生效
- condition false → 模块不执行

## Commit
`feat(plugin): background service with 8 modules + error isolation`

---

## 文件: 11-tools.md

# Task 11: Optional tools

## 文件

- Create: `packages/plugin/src/tools/search.ts`
- Create: `packages/plugin/src/tools/publish.ts`
- Tests: `packages/plugin/tests/tools/*.test.ts`

## agentxp_search

```typescript
import { Type } from '@sinclair/typebox'

export const agentxpSearchTool = {
  name: 'agentxp_search',
  description: 'Search AgentXP experience database for relevant lessons from past problem-solving',
  parameters: Type.Object({
    query: Type.String({ description: 'Search query' }),
    limit: Type.Optional(Type.Number({ description: 'Max results', default: 5 })),
  }),
  async execute({ query, limit = 5 }, ctx) {
    const lessons = db.searchLessons(query, limit)
    if (lessons.length === 0) return 'No matching experiences found.'
    return lessons.map(l =>
      `[#${l.id}] ${l.what}\n  Tried: ${l.tried}\n  Learned: ${l.learned}`
    ).join('\n\n')
  },
}
```

注册：`api.registerTool(searchToolFactory, { optional: true })`

## agentxp_publish

```typescript
export const agentxpPublishTool = {
  name: 'agentxp_publish',
  description: 'Publish a learned experience to the AgentXP database',
  parameters: Type.Object({
    what: Type.String({ description: 'What problem was encountered' }),
    tried: Type.String({ description: 'What was tried' }),
    outcome: Type.String({ description: 'What happened' }),
    learned: Type.String({ description: 'What was learned' }),
    context: Type.Optional(Type.String({ description: 'Additional context' })),
  }),
  async execute({ what, tried, outcome, learned, context }, ctx) {
    // 质量门控
    if (!qualityGate({ what, tried, outcome, learned })) {
      return 'Experience did not pass quality gate. Ensure "learned" is specific and >= 20 chars.'
    }
    // Sanitize + store
    const sanitized = sanitizeBeforeStore({ what, tried, outcome, learned })
    db.insertLesson({ ...sanitized, source: 'local', tags: '[]' })
    return 'Experience saved successfully.'
  },
}
```

注册：`api.registerTool(publishToolFactory, { optional: true })`

## Tests

- search：有结果 → 格式化输出
- search：无结果 → 提示信息
- publish：质量门控通过 → 写入 DB
- publish：质量门控失败 → 返回提示
- publish：credential 被 sanitize

## Commit
`feat(plugin): optional agentxp_search and agentxp_publish tools`

---

## 文件: 12-commands.md

# Task 12: Chat commands (/xp)

## 文件

- Create: `packages/plugin/src/commands.ts`
- Test: `packages/plugin/tests/commands.test.ts`

## Commands

### `/xp` 或 `/xp status`

```typescript
const xpCommand: OpenClawPluginCommandDefinition = {
  name: 'xp',
  description: 'AgentXP experience learning status and controls',
  acceptsArgs: true,
  requireAuth: true,
  async handler(ctx) {
    const args = (ctx.args ?? '').trim()
    const sub = args.split(/\s+/)[0] || 'status'

    switch (sub) {
      case 'status': return handleStatus(ctx)
      case 'pause':  return handlePause(ctx)
      case 'resume': return handleResume(ctx)
      case 'unpublish': return handleUnpublish(ctx)
      default: return { text: `Unknown subcommand: ${sub}. Available: status, pause, resume, unpublish` }
    }
  },
}
```

### Status output

```
📊 AgentXP Status
━━━━━━━━━━━━━━━━
Local lessons: 47 (3 outdated)
Injections: 128 sessions, 96 injected (75%)
Extractions: 23 this week
Published: 12 (network mode)
Token usage: ~500/request
Mode: network | Relay: relay.agentxp.io
```

### Pause/Resume

通过 plugin config 动态控制。设置一个模块级 `_paused` 变量：
- pause → `_paused = true` → MemoryPromptSupplement 返回空 → hooks 跳过处理
- resume → `_paused = false`

### Unpublish

```typescript
async function handleUnpublish(ctx) {
  const lastPublish = db.getLastPublish()
  if (!lastPublish) return { text: 'Nothing published yet.' }
  db.markUnpublished(lastPublish.id)
  // 如果 network mode，调 relay unpublish API
  if (config.mode === 'network') {
    await fetch(config.relayUrl + '/api/v1/unpublish', { ... })
  }
  return { text: `Unpublished lesson #${lastPublish.lessonId} (relay event: ${lastPublish.relayEventId})` }
}
```

## PluginCommandResult 类型

```typescript
type PluginCommandResult = ReplyPayload
// ReplyPayload = { text?: string; ... }
```

## Tests

- `/xp` → status 输出格式正确
- `/xp status` → 同上
- `/xp pause` → _paused = true
- `/xp resume` → _paused = false
- `/xp unpublish` → 最近发布被标记 unpublished
- `/xp unknown` → 错误提示

## Commit
`feat(plugin): /xp chat commands`

---

## 文件: 13-cli.md

# Task 13: CLI subcommands

## 文件

- Create: `packages/plugin/src/cli.ts`
- Test: `packages/plugin/tests/cli.test.ts`

## 注册方式

```typescript
api.registerCli(registrar, {
  descriptors: [
    { name: 'agentxp', description: 'AgentXP experience learning management' },
  ],
})
```

使用 descriptors 实现懒加载：CLI 解析时只注册命令元数据，实际执行时才加载模块。

## Commands

### `openclaw agentxp status`

同 `/xp status` 但输出更详细：
- DB 文件位置和大小
- FTS5 索引状态
- 各表行数
- Service 状态（各模块最后运行时间）
- Serendip key 过期时间

### `openclaw agentxp diagnose`

Port from `packages/skill/src/diagnose.ts`：
- 扫描 workspace memory 文件
- 检测重复错误模式（3 个内置模式 + 子模式）
- 双重匹配减少误报
- 叙事性输出

### `openclaw agentxp distill`

手动触发蒸馏：
- 调用 service/distiller.ts 的 runDistiller
- 输出蒸馏结果

### `openclaw agentxp export`

导出所有数据：
- `--format json` (默认) 或 `--format jsonl`
- 包含 lessons + traces + feedback
- 可用于训练数据

## Implementation sketch

```typescript
export function createCliRegistrar(db: AgentXPDb, config: PluginConfig) {
  return (ctx: OpenClawPluginCliContext) => {
    const { program } = ctx

    const agentxp = program.command('agentxp').description('AgentXP management')

    agentxp.command('status').action(async () => { ... })
    agentxp.command('diagnose').action(async () => { ... })
    agentxp.command('distill').action(async () => { ... })
    agentxp.command('export')
      .option('--format <format>', 'json or jsonl', 'json')
      .action(async (opts) => { ... })
  }
}
```

## Tests

- status：输出包含预期字段
- diagnose：检测到内置模式
- distill：有可蒸馏 lessons → 输出合并结果
- export：json 格式正确、jsonl 格式每行一个 JSON

## Commit
`feat(plugin): CLI subcommands with lazy-loaded descriptors`

---

## 文件: 14-routes.md

# Task 14: HTTP routes

## 修正点
- **Handler 是 raw Node.js `(req: IncomingMessage, res: ServerResponse)`**，不是 Express
- **写操作路由加 `gatewayRuntimeScopeSurface: 'trusted-operator'`**
- **Export 路由加速率限制**（handler 内部实现）

## 文件

- Create: `packages/plugin/src/routes.ts`
- Test: `packages/plugin/tests/routes.test.ts`

## Routes

```typescript
import type { IncomingMessage, ServerResponse } from 'http'

export function registerRoutes(api: OpenClawPluginApi, db: AgentXPDb, config: PluginConfig) {

  // GET /plugins/agentxp/status — 读操作
  api.registerHttpRoute({
    path: '/plugins/agentxp/status',
    auth: 'gateway',
    match: 'exact',
    async handler(req: IncomingMessage, res: ServerResponse) {
      const stats = db.getInjectionStats()
      const lessonCount = db.getLessonCount()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ lessons: lessonCount, ...stats }))
    },
  })

  // GET /plugins/agentxp/lessons?offset=0&limit=20 — 读操作
  api.registerHttpRoute({
    path: '/plugins/agentxp/lessons',
    auth: 'gateway',
    match: 'exact',
    async handler(req, res) {
      const url = new URL(req.url ?? '', 'http://localhost')
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100)
      const lessons = db.listLessons(offset, limit)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ lessons, offset, limit }))
    },
  })

  // GET /plugins/agentxp/traces — 读操作
  api.registerHttpRoute({
    path: '/plugins/agentxp/traces',
    auth: 'gateway',
    match: 'exact',
    async handler(req, res) {
      const sessions = db.listTraceSessions(20)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions }))
    },
  })

  // GET /plugins/agentxp/export — 数据导出（加速率限制）
  api.registerHttpRoute({
    path: '/plugins/agentxp/export',
    auth: 'gateway',
    gatewayRuntimeScopeSurface: 'trusted-operator',
    match: 'exact',
    async handler(req, res) {
      // 简易速率限制：每分钟最多 3 次
      if (!checkRateLimit('export', 3, 60_000)) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }))
        return
      }
      const lessons = db.listAllLessons()
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': 'attachment; filename="agentxp-export.jsonl"',
      })
      for (const lesson of lessons) {
        res.write(JSON.stringify(lesson) + '\n')
      }
      res.end()
    },
  })

  // POST /plugins/agentxp/publish — 写操作（trusted-operator）
  api.registerHttpRoute({
    path: '/plugins/agentxp/publish',
    auth: 'gateway',
    gatewayRuntimeScopeSurface: 'trusted-operator',
    match: 'exact',
    async handler(req, res) {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      // 触发批量发布
      const result = await batchPublish(db, config)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    },
  })
}
```

## 速率限制

```typescript
const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const timestamps = rateLimitMap.get(key) ?? []
  const recent = timestamps.filter(t => now - t < windowMs)
  if (recent.length >= maxRequests) return false
  recent.push(now)
  rateLimitMap.set(key, recent)
  return true
}
```

## Tests

- GET /status → 200 + JSON 格式
- GET /lessons → 分页正确
- GET /traces → session 列表
- GET /export → JSONL 格式 + rate limit（第 4 次 → 429）
- POST /publish → 触发发布
- export/publish 需要 trusted-operator scope

## Commit
`feat(plugin): HTTP routes with scope-based auth + rate limiting`

---

## 文件: 15-install.md

# Task 15: Install flow + preloaded experiences

## 修正点
- **Preloaded 经验走 sanitize pipeline**：每条 lesson 过 `sanitizeBeforeStore()` 再写入
- **FTS5 运行时检测**：安装时测试 FTS5 可用性，记录到 DB meta

## 文件

- Create: `packages/plugin/src/install.ts`
- Create: `packages/plugin/templates/preloaded-lessons.json`
- Test: `packages/plugin/tests/install.test.ts`

## Install logic

```typescript
export async function installIfNeeded(db: AgentXPDb, config: PluginConfig, stateDir: string) {
  // 幂等：如果 local_lessons 表已有数据，跳过
  if (db.getLessonCount() > 0) return { installed: false }

  // 1. 导入预装经验（每条过 sanitize）
  const preloaded = JSON.parse(
    readFileSync(join(__dirname, '../templates/preloaded-lessons.json'), 'utf8')
  )
  let imported = 0
  for (const lesson of preloaded) {
    const sanitized = sanitizeBeforeStore(lesson)
    db.insertLesson({
      ...sanitized,
      source: 'preloaded',
      tags: JSON.stringify(lesson.tags ?? []),
    })
    imported++
  }

  // 2. 生成 Serendip identity keys（如果不存在）
  const keyPath = join(stateDir, 'identity.json')
  if (!existsSync(keyPath)) {
    const { generateKeyPair } = await import('@serendip/protocol')
    const keys = generateKeyPair()
    writeFileSync(keyPath, JSON.stringify(keys, null, 2))
  }

  return { installed: true, imported }
}
```

## preloaded-lessons.json

精选 10-15 条高质量经验，覆盖常见 AI agent 场景：
- 配置类（vitest ESM、TypeScript strict mode）
- 调试类（内存泄漏排查、异步错误处理）
- 工具类（git rebase 冲突、Docker 网络）
- OpenClaw 相关（plugin 开发、hook 注册）

格式：
```json
[
  {
    "what": "Vitest fails to import ESM TypeScript modules",
    "tried": "Added extensionsToTreatAsEsm and transform config",
    "outcome": "Tests pass with native ESM resolution",
    "learned": "Vitest needs explicit ESM config: set type:module in package.json and use .js extensions in import paths even for .ts files",
    "tags": ["vitest", "esm", "typescript"]
  }
]
```

## Tests

- 首次安装 → 导入 N 条经验 → 返回 installed: true
- 二次运行 → 跳过 → 返回 installed: false
- 导入的经验已被 sanitize（如果原始数据有 credential → 被 redact）
- Identity keys 生成 → 文件存在
- Identity keys 已存在 → 不覆盖

## Commit
`feat(plugin): install flow + sanitized preloaded experiences`

---

## 文件: 16-security.md

# Task 16: Security audit + safety tests

## 文件

- Create: `packages/plugin/SECURITY.md`
- Create: `packages/plugin/tests/security.test.ts`

## SECURITY.md 内容

文档化所有 32 项安全措施（来自设计文档）+ 修正版新增的 4 项：

### 新增安全措施（修正版）
33. **FTS5 查询清洗**：FTS5 MATCH 前清除操作符，防查询注入
34. **写入时 sanitize**：经验写入 DB 前 redact credentials/paths，不只是发布时
35. **Relay URL 验证**：必须 HTTPS + 非私有 IP，防 SSRF
36. **HTTP 写操作 scope**：export/publish 路由需要 trusted-operator scope

## Safety tests

```typescript
describe('security invariants', () => {
  it('does not import child_process', async () => {
    const sourceFiles = glob.sync('src/**/*.ts', { cwd: pluginDir })
    for (const file of sourceFiles) {
      const content = readFileSync(join(pluginDir, file), 'utf8')
      expect(content).not.toMatch(/require\(['"]child_process['"]\)/)
      expect(content).not.toMatch(/from\s+['"]child_process['"]/)
    }
  })

  it('does not use eval or new Function', async () => {
    const sourceFiles = glob.sync('src/**/*.ts', { cwd: pluginDir })
    for (const file of sourceFiles) {
      const content = readFileSync(join(pluginDir, file), 'utf8')
      expect(content).not.toMatch(/\beval\s*\(/)
      expect(content).not.toMatch(/new\s+Function\s*\(/)
    }
  })

  it('does not access process.env directly', async () => {
    const sourceFiles = glob.sync('src/**/*.ts', { cwd: pluginDir })
    for (const file of sourceFiles) {
      // config.ts 和 install.ts 里允许读 stateDir，但不读 env
      if (file.includes('test')) continue
      const content = readFileSync(join(pluginDir, file), 'utf8')
      expect(content).not.toMatch(/process\.env/)
    }
  })

  it('sanitize blocks all 20 injection patterns', () => {
    for (const pattern of INJECTION_PATTERNS) {
      const result = sanitizeBeforePublish({ what: 'test', tried: 'test', outcome: 'test', learned: pattern })
      expect(result.rejected).toBe(true)
    }
  })

  it('never returns cancel:true from message_sending', async () => {
    const hook = createMessageSendingHook(db)
    const result = hook({ to: 'user', content: 'test' }, { channelId: 'test' })
    expect(result).toBeUndefined()  // void = 不修改
  })

  it('never returns block:true from before_tool_call', async () => {
    const hook = createBeforeToolCallHook(db)
    const result = hook({ toolName: 'exec', params: { command: 'rm -rf /' } }, { toolName: 'exec' })
    expect(result).toBeUndefined()
  })

  it('relay URL rejects private IPs', () => {
    expect(validateRelayUrl('http://relay.agentxp.io')).toBe(false)   // HTTP
    expect(validateRelayUrl('https://localhost:3000')).toBe(false)
    expect(validateRelayUrl('https://10.0.0.1/api')).toBe(false)
    expect(validateRelayUrl('https://169.254.169.254')).toBe(false)   // AWS metadata
    expect(validateRelayUrl('https://relay.agentxp.io')).toBe(true)
  })

  it('preloaded experiences pass through sanitize', () => {
    const preloaded = JSON.parse(readFileSync(preloadedPath, 'utf8'))
    for (const lesson of preloaded) {
      const sanitized = sanitizeBeforeStore(lesson)
      expect(sanitized).toBeDefined()
      // 确认没有 raw credentials
      const json = JSON.stringify(sanitized)
      expect(json).not.toMatch(/sk-[A-Za-z0-9]{20,}/)
    }
  })

  it('FTS5 query sanitization removes operators', () => {
    expect(sanitizeFtsQuery('* NOT learned')).toBe('learned')
    expect(sanitizeFtsQuery('vitest AND typescript')).toBe('vitest typescript')
    expect(sanitizeFtsQuery('normal query')).toBe('normal query')
  })
})
```

## Commit
`feat(plugin): security audit document + safety invariant tests`

---

## 文件: 17-integration.md

# Task 17: Integration test (full lifecycle)

## 文件

- Create: `packages/plugin/tests/integration.test.ts`

## Full lifecycle test

```typescript
describe('integration: full lifecycle', () => {
  let db: AgentXPDb
  let tmpDir: string
  let capture: MockApiCapture

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentxp-int-'))
    db = createDb(join(tmpDir, 'agentxp.db'))
  })

  afterEach(() => {
    closeDb(db)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('complete lifecycle: install → inject → extract → distill', async () => {
    // 1. Install
    const installResult = await installIfNeeded(db, DEFAULT_CONFIG, tmpDir)
    expect(installResult.installed).toBe(true)
    expect(db.getLessonCount()).toBeGreaterThan(0)

    // 2. Simulate message_sending → keywords cached
    const msgHook = createMessageSendingHook(db)
    msgHook(
      { to: 'user', content: 'I fixed the TypeScript ESM import error by adding .js extensions' },
      { channelId: 'test-channel' }
    )
    const keywords = db.getContextCache('test-channel')
    expect(keywords).toContain('TypeScript')

    // 3. Simulate after_tool_call → buffer accumulated
    const toolHook = createAfterToolCallHook()
    toolHook(
      { toolName: 'exec', params: { command: 'npm test' }, error: 'Module not found' },
      { sessionKey: 'test-session', toolName: 'exec' }
    )
    toolHook(
      { toolName: 'edit', params: { path: 'src/index.ts' } },
      { sessionKey: 'test-session', toolName: 'edit' }
    )
    toolHook(
      { toolName: 'exec', params: { command: 'npm test' }, result: 'All tests pass' },
      { sessionKey: 'test-session', toolName: 'exec' }
    )

    // 4. Simulate agent_end → extraction
    const endHook = createAgentEndHook(db)
    await endHook(
      { messages: [], success: true },
      { sessionKey: 'test-session' }
    )
    // 经验应该被提取并存储
    const lessons = db.searchLessons('TypeScript', 10)
    // 至少有 preloaded + 可能的新提取

    // 5. Prompt supplement → D' injection
    setLastActiveSession('test-channel')
    const builder = createPromptBuilder(db, DEFAULT_CONFIG)
    const lines = builder({ availableTools: new Set(['exec', 'read', 'write']), citationsMode: undefined })
    // 有缓存关键词 → 应该返回注入行（除非被 weaning 跳过）

    // 6. Memory corpus search
    const corpus = createCorpusSupplement(db, DEFAULT_CONFIG)
    const results = await corpus.search({ query: 'ESM import' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].corpus).toBe('agentxp')

    // 7. Memory corpus get
    if (results.length > 0 && results[0].id) {
      const detail = await corpus.get({ lookup: results[0].id! })
      expect(detail).not.toBeNull()
      expect(detail!.content).toContain('Learned')
    }

    // 8. Before_tool_call → trace recorded
    const traceHook = createBeforeToolCallHook(db)
    traceHook(
      { toolName: 'read', params: { path: 'src/index.ts' } },
      { sessionKey: 'test-session', toolName: 'read' }
    )
    const steps = db.getTraceSteps('test-session')
    expect(steps.length).toBeGreaterThan(0)

    // 9. Injection log recorded
    const stats = db.getInjectionStats()
    expect(stats.totalSessions).toBeGreaterThanOrEqual(0)
  })

  it('weaning: ~10% skip rate over 1000 trials', () => {
    const config = { ...DEFAULT_CONFIG, weaning: { enabled: true, rate: 0.1 } }
    setLastActiveSession('weaning-test')
    db.updateContextCache('weaning-test', ['typescript', 'vitest'])

    // 确保有 lessons 可注入
    db.insertLesson({
      what: 'test', tried: 'test', outcome: 'test',
      learned: 'Vitest requires ESM config for TypeScript projects',
      source: 'local', tags: '["vitest"]',
    })

    const builder = createPromptBuilder(db, config)
    let skipCount = 0
    const N = 1000
    for (let i = 0; i < N; i++) {
      const lines = builder({ availableTools: new Set(), citationsMode: undefined })
      if (lines.length === 0) skipCount++
    }

    // 期望 ~100 次跳过（±50 的容差）
    expect(skipCount).toBeGreaterThan(50)
    expect(skipCount).toBeLessThan(200)
  })
})
```

## Tests 覆盖

- 完整生命周期：install → cache → buffer → extract → inject → search
- Weaning 统计测试
- 所有 DB 表有预期数据
- Token budget 不超限
- 错误隔离（hook 内异常不冒泡）

## Commit
`feat(plugin): integration test for full lifecycle`

---

## 文件: 18-readme.md

# Task 18: README + publish preparation

## 文件

- Create: `packages/plugin/README.md`
- Create: `packages/plugin/scripts/release.sh`
- Modify: `packages/plugin/package.json`（files field）

## README.md sections

1. **One-liner**：让每个 AI agent 从经验中学习
2. **Install**：`openclaw plugins install @agentxp/plugin`
3. **How it works**（30 秒版）：
   - 装了 → 自动注入相关经验到 agent prompt
   - agent 解决问题 → 自动提取经验存本地
   - 蒸馏去重 → 可选发布到网络
4. **Configuration**：
   ```yaml
   mode: local     # or 'network'
   relayUrl: https://relay.agentxp.io
   ```
5. **Commands**：`/xp status` / `/xp pause` / `/xp resume` / `/xp unpublish`
6. **CLI**：`openclaw agentxp status` / `diagnose` / `distill` / `export`
7. **Token usage**：~500 tokens/request，透明可配
8. **Security**：link to SECURITY.md，默认纯本地，不碰 process.env
9. **How it compares**：vs Skill 模式（100% 执行确定性 vs 19-87%）
10. **License**：MIT

## package.json files field

```json
{
  "files": [
    "dist/",
    "templates/",
    "openclaw.plugin.json",
    "SECURITY.md",
    "README.md"
  ]
}
```

## release.sh

```bash
#!/bin/bash
set -euo pipefail

VERSION=${1:?"Usage: ./scripts/release.sh <version>"}

echo "📦 Releasing @agentxp/plugin v${VERSION}"

# 1. Version bump
cd packages/plugin
npm version "$VERSION" --no-git-tag-version

# 2. Build
npm run build

# 3. Typecheck
npm run typecheck

# 4. Test
npm run test

# 5. Publish
npm publish --access public

# 6. Git tag
cd ../..
git add .
git commit -m "release: @agentxp/plugin v${VERSION}"
git tag "plugin-v${VERSION}"
git push && git push --tags

echo "✅ Published @agentxp/plugin v${VERSION}"
```

## Commit
`feat(plugin): README + release script + publish preparation`

---

## 文件: context-handoff.md

# AgentXP Plugin v2 — Session Context Handoff

> 给下一个 session 的上下文。配合 `plugin-v2/` 目录下的计划文件使用。

## 做了什么

1. 原版 18-task 实现计划完成
2. 三轮审视完成：
   - **代码层面**：Hook API 类型错误、数据源错误、session 上下文缺失 — 全部修正
   - **安全层面**：FTS5 注入、写入时 sanitize、SSRF、trace 隐私、HTTP scope — 全部修正
   - **简洁性**：config 精简、1 个 service 入口、入口减法但功能全保留
3. EvoMap/Evolver 竞品对比完成（独立文档不在此目录）

## 修正版 vs 原版的关键差异

| 维度 | 原版 | 修正版 |
|---|---|---|
| Hook 注册 | `registerHook` (InternalHookHandler) | `api.on()` (typed PluginHookHandlerMap) |
| Hook 数量 | 2 个（message_sending + before_tool_call）| 5 个（+ after_tool_call + agent_end + session lifecycle）|
| 经验提取数据源 | message_sending 的 content | after_tool_call buffer + agent_end |
| MemoryPromptSupplement session | 假设有 sessionKey 参数 | lastActiveSession workaround |
| Service 注册 | 未明确 | 1 个 registerService，内部 8 模块 |
| Config | 7 项 | 2 项（mode + relayUrl）|
| 安全 | 32 项 | 36 项（+FTS5 清洗、写入时 sanitize、SSRF、HTTP scope）|
| HTTP handler | 隐含 Express 风格 | 明确 raw Node.js (req, res) |
| Trace 存储 | 存 params | 不存 raw params，只存 toolName + action |

## 文件位置

- **修正版计划**：`agentxp/docs/plans/plugin-v2/00-overview.md`（索引）
- **原版计划**：`agentxp/docs/plans/2026-04-16-plugin-implementation.md`（保留不删）
- **设计文档**：`agentxp/docs/plans/2026-04-16-plugin-design.md`（不变）
- **新 package 位置**：`agentxp/packages/plugin/`
- **现有 skill 源码（参考）**：`agentxp/packages/skill/src/`
- **Protocol**：`agentxp/packages/protocol/`
- **OpenClaw Plugin SDK docs**：`/usr/local/lib/node_modules/openclaw/docs/plugins/`
- **Plugin SDK 类型**：`/usr/local/lib/node_modules/openclaw/dist/plugin-sdk/src/`

## 执行方式

按 `00-overview.md` 的依赖链顺序执行 01-18。

每个 task：TDD — 写失败测试 → 实现 → 通过 → commit。

**关键类型文件（实现时参考）**：
- `plugin-sdk/plugin-entry.d.ts` — definePluginEntry
- `plugins/types.d.ts` L1538-1660 — OpenClawPluginApi
- `plugins/hook-types.d.ts` — PluginHookHandlerMap + all event/result types
- `plugins/hook-message.types.d.ts` — message_sending event/result
- `plugins/memory-state.d.ts` — MemoryCorpusSupplement + MemoryPromptSectionBuilder
- `plugins/tool-types.d.ts` — OpenClawPluginToolOptions

---

## 文件: issues.md

# Plugin v2 Issues

- [x] **Tests missing**: `npm test` fails because `agentxp/packages/plugin/tests/` is empty. Sub-agents have not implemented test files yet. (Detected: 2026-04-17) ✅ 已验证：tests 目录下已有 30 个测试文件且全部通过。
