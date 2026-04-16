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
