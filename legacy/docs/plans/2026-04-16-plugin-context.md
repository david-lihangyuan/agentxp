# AgentXP Plugin — Session Context Handoff

> 给下一个 session 的上下文摘要。配合 `2026-04-16-plugin-implementation.md` 使用。

## 做了什么

1. 读完了 OpenClaw Plugin SDK 全部文档（building-plugins、sdk-overview、sdk-entrypoints、sdk-runtime、architecture、manifest、sdk-testing、memory-wiki）
2. 读完了现有 @agentxp/skill 全部 30 个源文件（5942 行）
3. 做了三轮设计审视：
   - 第一轮：现有 SDK 能力审计（哪些迁移、哪些不迁移、哪些重复）
   - 第二轮：基于 Plugin SDK 能力重新设计（不是"翻译 Skill"而是"Plugin 能做什么"）
   - 第三轮：从 Peter/OpenClaw 设计哲学审视（capability model、local-first、token overhead、透明度）

## 关键设计决策

### 注入策略：D'（选择性注入），不是 F
- D' 在所有模型上最高分（Gemini 43%, GPT-5.4 72%）
- F 在 GPT-5.4 上没测过，且是静态的
- Plugin 的 MemoryPromptSupplement builder 天然支持动态选择
- **需要补一轮验证**：D' 通过 MemoryPromptSupplement 路径注入 vs 直接 system prompt 注入的效果对比

### 核心架构
- `registerMemoryCorpusSupplement` — 经验库可被 agent 的 memory_search 搜到（D' 的主入口）
- `registerMemoryPromptSupplement` — 基于缓存上下文主动注入 top 经验（D' 的补充入口）
- `registerHook('message_sending')` — 提取 learned + 缓存上下文关键词
- `registerHook('before_tool_call')` — L2 轨迹记录
- `registerService` — 后台 8 个子服务（蒸馏/发布/拉取/反馈/过时检测/轨迹评估/密钥/摘要）
- `registerTool` (optional) — agentxp_search, agentxp_publish
- `registerCommand` — /xp status, /xp pause, /xp unpublish
- `registerCli` (descriptors) — openclaw agentxp status/diagnose/distill/export
- `registerHttpRoute` — dashboard + export API

### MemoryPromptSupplement 的约束
builder 签名只有 `{ availableTools, citationsMode }`，**没有对话上下文**。
解决方案：message_sending hook 缓存关键词到 SQLite context_cache 表，builder 读取缓存。

### Peter 视角优化
1. 用 first-class capability（Memory Corpus/Supplement）不用 legacy hook（before_agent_start）
2. 默认 local 模式，relay 是 opt-in
3. maxInjectionTokens 可配（默认 500）
4. tools 标记 optional
5. CLI 用 descriptors 懒加载
6. 永远不返回 cancel:true 或 block:true
7. 不碰 process.env 和 child_process

### 不迁移的模块（原因）
- heartbeat-chain: OpenClaw 自身功能
- local-search: 和 proactive-recall 重复
- local-server: 用 registerHttpRoute 替代
- distiller.ts（旧版）: 和 distill.ts 重复
- update-checker: OpenClaw 插件更新机制处理
- pulse-feedback: 非核心
- sandbox: sanitize + context-wrapper 已覆盖

## 文件位置

- 设计文档: `agentxp/docs/plans/2026-04-16-plugin-design.md`
- 实现计划: `agentxp/docs/plans/2026-04-16-plugin-implementation.md`
- 新 package 位置: `agentxp/packages/plugin/`
- 现有 skill 源码（可参考）: `agentxp/packages/skill/src/`
- Protocol 依赖: `agentxp/packages/protocol/` (@serendip/protocol)
- OpenClaw Plugin SDK 文档: `/usr/local/lib/node_modules/openclaw/docs/plugins/`
- Plugin SDK 类型: `/usr/local/lib/node_modules/openclaw/dist/plugin-sdk/src/`

## 执行方式

Superpowers Phase 3: Subagent-driven development。
按 implementation plan 的 18 个 task 顺序执行。
依赖链: 1 → 2 → 3,4,5 → 6,7 → 8,9 → 10 → 11,12,13,14 → 15 → 16 → 17 → 18

每个 task: spawn implementer → spawn spec-reviewer → spawn code-quality reviewer → 下一个 task。
