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
