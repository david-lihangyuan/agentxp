# AgentXP Plugin v3 — 端到端闭环测试报告

> 日期：2026-04-17 22:30 JST
> 测试人：航远
> 方式：B 方案（完整端到端）

---

## 闭环概览

```
安装 → Onboarding → Observe → Reflect → Evolve(publish) → Recall(拉回) → Inject(注入)
  ✅        ✅          ✅       ⚠️         ✅              ❌            ❌
```

---

## 各环节详情

### ✅ 环节 1: Onboarding（冷启动扫描）

- **状态**：通过
- **证据**：DB 有 5 条 onboarding reflections（id=1-5），panel 能 render
- **问题**：无

### ✅ 环节 2: Observe（轨迹记录）

- **状态**：通过
- **证据**：trace_steps = 1409+，before/after_tool_call 实时打点
- **问题**：无

### ⚠️ 环节 3: Reflect（反思触发 + 存储）

- **状态**：部分通过
- **证据**：
  - `reflection_prompts` 表有 62 条记录 ✅（agent_end hook 正常触发）
  - **但 62 条全部 consumed=0**——从未被消费 ❌
  - 只有 1 条非 onboarding 的 reflection（id=6，手动测试写入）
- **根因**：见 Bug #1（memory-prompt 从不触发）
- **影响**：agent 永远看不到反思提示，自然不会写结构化反思

### ✅ 环节 4: Evolve（蒸馏 + 发布）

- **状态**：Publish 通过，Distill 未触发
- **证据**：
  - id=6 已 publish 到 Relay（relay_event_id = 55273e51...，relay 上可查）
  - published_log 有 1 条成功记录
  - distilled 表 = 0（因为没有足够同类 reflections 触发蒸馏，这是正常的——前置环节没跑）
- **问题**：distiller 逻辑存在但缺数据，属于前置依赖缺失

### ❌ 环节 5a: Recall（从 Relay 拉经验）

- **状态**：未实现
- **证据**：network_experiences = 0
- **根因**：**整个 plugin 没有"从 Relay 搜索/拉取经验"的写入逻辑**
  - `publisher.ts` 的 `pullPulseEvents()` 只拉 pulse 状态更新
  - `db.ts` 有 `insertNetworkExperience` prepared statement，但无 caller
  - `memory-corpus.ts` 能查 network_experiences，但没人往里写
  - 这是设计文档里 v1.1 阶段的功能，尚未实现

### ❌ 环节 5b: Inject（经验注入到 agent context）

- **状态**：从未触发
- **证据**：injection_log = 0
- **根因**：见 Bug #1

---

## Bug 清单

### Bug #1（Critical）：memory-prompt builder 永远返回空数组

**文件**：`memory-prompt.ts` + `hooks/state.ts`

**根因**：
- `memory-prompt.ts` 内部维护了自己的 `_lastActiveSessionKey` 变量（L27）
- `memory-prompt.ts` 导出了 `setLastActiveSession()` 函数（L35）
- `hooks/state.ts` 也有一个同名的 `setLastActiveSession()` 函数
- **两个是完全独立的变量，互不通信**
- `hooks/session-start.ts` 和 `hooks/message-sending.ts` 调用的是 `hooks/state.ts` 的版本
- **没有任何代码调用 `memory-prompt.ts` 的 `setLastActiveSession()`**
- 结果：`_lastActiveSessionKey` 永远是 `null`
- Guard 1（L77）永远命中 → builder 永远返回 `[]`
- **所有下游功能全部失效**：proactive recall、checkpoint、reflection prompt 消费、selective injection

**影响**：injection_log = 0 + reflection_prompts 62 条全未消费 + 注入从未发生

**修复**：在 hooks/session-start.ts 和 hooks/message-sending.ts 里同时调用 memory-prompt.ts 的 setLastActiveSession()。或者更好的方案：统一为一个共享 state 模块。

**修复难度**：1 行代码（在 session-start hook 里加一行 import + 调用）

---

### Bug #2（Medium）：context_cache.first_message 永远是 'true'

**文件**：`hooks/message-sending.ts` L97

**现象**：context_cache 里 `first_message = 'true'` 但 `tool_count = 23`

**根因**：`upsertContextCache` 在 message-sending hook 里被调用时写 `'false'`（L97），但由于 memory-prompt builder 从不执行（Bug #1），proactive recall 的 `if (cache.tool_count === 0)` 分支从未有机会检查 first_message。实际上 first_message 字段在逻辑上是多余的——proactive recall 用 tool_count 判断。

**影响**：低。被 Bug #1 掩盖了。

---

### Bug #3（Feature Gap）：网络经验拉取未实现

**文件**：缺失（应在 `service/` 下新增模块）

**现象**：network_experiences 表始终为空

**需要实现**：
1. 新增 `service/network-puller.ts`
2. 在 evolve tick 里调用
3. 从 Relay API 搜索同 domain 经验（GET /api/v1/events?kind=intent.broadcast&limit=N）
4. 过滤掉自己发布的（pubkey != self）
5. 写入 network_experiences 表
6. 在 `injection-engine.ts` 的 selectExperiences 里加入 network 搜索

**前置**：Relay 需要支持搜索 API（当前 /api/v1/events 只支持 list，不支持语义搜索）

---

### Bug #4（Medium）：memory-corpus mode='local' 导致网络搜索被跳过

**文件**：`index.ts` L205 + `memory-corpus.ts` L121-140

**现象**：index.ts 注册 corpus supplement 时用 `{ mode: 'local' }`

**影响**：即使 network_experiences 表有数据，memory_search 也搜不到——因为网络搜索分支只在 `mode === 'network'` 时执行

**修复**：改为 `{ mode: 'network' }`（同时搜本地和网络），或新增 `mode: 'all'`

---

### Bug #5（Low）：reflection_prompts consumed 标记从不触发

**根因**：Bug #1 的下游。`memory-prompt.ts` L108 有 `db.markPromptConsumed.run(prompt.id)`，但整个 builder 从不执行，所以 consumed 永远是 0。

**修复**：修 Bug #1 后自动解决。

---

## 数据基线快照（测试时刻 22:25 JST）

| 表 | 数量 | 备注 |
|---|---|---|
| reflections | 6 | 5 onboarding + 1 手动测试 |
| trace_steps | 1409 | 正常，实时增长 |
| reflection_prompts | 62 | 全部 consumed=0 ❌ |
| published_log | 1 | id=6 成功发布 |
| injection_log | 0 | 从未注入 ❌ |
| network_experiences | 0 | 从未拉取 ❌ |
| distilled | 0 | 无数据源 |
| milestones | 1 | first_experience |
| context_cache | 活跃 | keywords 有值 |
| plugin_state | 2 | onboarding_done + install_date |

---

## 修复优先级

| # | Bug | 优先级 | 工作量 | 影响范围 |
|---|---|---|---|---|
| 1 | memory-prompt state 不通 | **P0** | 15min | 打通注入+反思消费+checkpoint 全链路 |
| 3 | 网络经验拉取未实现 | **P1** | 2-4h | 打通跨 agent 经验流通 |
| 4 | corpus mode='local' | **P1** | 5min | 配合 #3 |
| 2 | first_message 逻辑 | P2 | 10min | 被 #1 掩盖 |
| 5 | consumed 标记 | P3 | 0min | 修 #1 后自动解 |

**一句话**：**Bug #1 是唯一的 show-stopper。修掉它，注入+反思+checkpoint 三条线全部通。然后 Bug #3 是下一个里程碑（网络回灌）。**
