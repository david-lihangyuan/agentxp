# AgentXP Plugin v3 — 全部设计文档

> 来自 `docs/plans/plugin-v3/`，按文件名顺序合并。


---

## 文件: 01-db-schema.md

# Phase 1 — DB Schema 设计

> 范围：plugin 的 SQLite 存储层
> 对齐：设计文档 §5（反思框架）、§7（声誉/Pulse）、§11（安全）、§14（Human Layer）

---

## 设计文档要求 → 表设计

### 1. reflections（§5.2 分类存储）

> "反思不是时间线——按性质分类。搜索意图不同所以分开。"

| 列 | 来源 | 说明 |
|---|---|---|
| id | — | 主键 |
| session_id | §5.2 | 哪个 session 产生的 |
| category | §5.2 | mistake / lesson / feeling / thought |
| title | §5.4 | 反思标题 |
| tried | §5.4 | 具体做了什么 |
| expected | §5.4 | 预期结果 |
| outcome | §5.4 | succeeded / failed / partial |
| learned | §5.4 | 可执行的教训 |
| why_wrong | §5.2 | "为什么当时觉得自己是对的"——关键问题 |
| tags | §5.4 | 自由标签（JSON） |
| quality_score | §5.5 | 质量门控分数 0-1 |
| publishable | §5.5 | 是否通过质量门控 |
| visibility | §11.2 | public / private / auto |
| created_at | — | Unix 时间戳 |

索引：category、session_id、created_at

---

### 2. distilled（§5.5 周期蒸馏）

> "定期把积累的条目蒸馏为核心洞察。原始条目归档。"

| 列 | 来源 | 说明 |
|---|---|---|
| id | — | 主键 |
| category | §5.5 | mistake / lesson |
| title | — | 蒸馏标题 |
| summary | — | 蒸馏摘要 |
| source_ids | — | 来源反思 ID（JSON） |
| confidence | — | 置信度 |
| applied_count | — | 被引用次数 |
| success_count | — | 引用后成功次数 |
| created_at | — | |
| updated_at | — | |

索引：category

---

### 3. network_experiences（§2.4 + §7.5 Pulse + §7.6 Decay）

> Pulse 状态：dormant → discovered → verified → propagating
> 180 天半衰期，被验证会 revival

| 列 | 来源 | 说明 |
|---|---|---|
| id | — | 主键 |
| relay_event_id | §2.4 | UNIQUE |
| pubkey | §3 | 发布者公钥 |
| category | — | 可选分类 |
| title | — | |
| tried | — | |
| outcome | — | |
| learned | — | |
| tags | — | JSON |
| scope | §7.9 | 版本/平台/上下文（JSON） |
| trust_score | §7.3 | 影响力分数 |
| pulse_state | §7.5 | dormant / discovered / verified / propagating |
| last_verified_at | §7.6 | **新增**：最近验证时间，支持 decay revival |
| created_at | — | |
| pulled_at | — | |

索引：pubkey、pulse_state

---

### 4. trace_steps（反思触发前置数据）

追踪 session 内 tool call，用于生成反思 prompt。

| 列 | 说明 |
|---|---|
| id | 主键 |
| session_id | |
| action | 动作描述 |
| tool_name | 工具名 |
| significance | routine / significant / error |
| error_signature | 错误签名 |
| duration_ms | |
| timestamp | |

索引：session_id

---

### 5. published_log（Phase E6 发布追踪）

> "draft files track retry_count + last_attempt; on success store relay confirmation ID"

| 列 | 来源 | 说明 |
|---|---|---|
| id | — | 主键 |
| reflection_id | — | |
| relay_event_id | — | relay 确认 ID |
| pulse_state | §7.5 | |
| published_at | — | |
| unpublished_at | — | 撤回时间 |
| retry_count | E6 | **新增**：重试次数 |
| last_retry_at | E6 | **新增**：最近重试时间 |

索引：reflection_id

---

### 6. injection_log（注入效果追踪）

| 列 | 说明 |
|---|---|
| id | 主键 |
| session_id | |
| injected | 是否注入了 |
| token_count | token 用量 |
| source_ids | 注入的经验 ID（JSON） |
| source_type | reflection / distilled / network / onboarding |
| created_at | |

索引：session_id

---

### 7. feedback（§7.3 影响力 + §7.7 Experience Dialogue）

> extends / qualifies / supersedes 关系存在 relation 列

| 列 | 来源 | 说明 |
|---|---|---|
| id | — | 主键 |
| target_id | — | 目标经验 ID |
| target_type | — | reflection / network |
| type | §7.3 | cited / verified / contradicted / outdated |
| relation | §7.7 | extends / qualifies / supersedes / null |
| session_id | — | |
| comment | — | |
| created_at | — | |

索引：(target_id, target_type)

---

### 8. milestones（§14.7 情感里程碑）

> 类型 UNIQUE，只触发一次。每天最多一个。

| 列 | 来源 | 说明 |
|---|---|---|
| id | — | 主键 |
| type | §14.7 | UNIQUE |
| triggered_at | — | |
| message | §14.7 | 带情感分量的消息 |

---

### 9. subscriptions（§7.10 Experience Subscription）**新增**

> "搜不到不该是死胡同。agent 注册 pending intent，匹配到新经验时通知。"

| 列 | 来源 | 说明 |
|---|---|---|
| id | — | 主键 |
| query | §7.10 | 订阅查询文本 |
| tags | §7.10 | 可选 tag 过滤（JSON） |
| active | — | 是否活跃 |
| created_at | — | |
| notified_at | — | 最近通知时间 |

---

### 10. context_cache（运行时）

per-session 关键词/工具追踪，支撑反思循环。

| 列 | 说明 |
|---|---|
| session_id | 主键 |
| keywords | JSON |
| tool_count | |
| first_message | |
| checkpoint_due | |
| updated_at | |

---

### 11. reflection_prompts（运行时）

队列式反思 prompt，session 结束时写入，下次启动时消费。

| 列 | 说明 |
|---|---|
| id | 主键 |
| session_id | |
| prompt | |
| consumed | |
| created_at | |

索引：session_id

---

### 12. plugin_state（KV 存储）

通用状态存储。包括：onboarding_done、install_date、trust_level（§14.10）等。

| 列 | 说明 |
|---|---|
| key | 主键 |
| value | |
| updated_at | |

---

## FTS5 全文搜索

- reflections_fts：覆盖 title、tried、expected、learned、why_wrong、tags
- distilled_fts：覆盖 title、summary
- 自动同步触发器（INSERT/UPDATE/DELETE）
- FTS5 不可用时降级为 LIKE 查询

---

## 变更汇总（vs v2）

| 变更 | 类型 | 来源 |
|---|---|---|
| `DbV2` → `Db`，`createDbV2` → `createDb` | 重命名 | 清理 |
| published_log + retry_count / last_retry_at | 新增列 | §E6 |
| network_experiences + last_verified_at | 新增列 | §7.6 |
| subscriptions 表 | 新增表 | §7.10 |
| trust_level 存 plugin_state | 设计决策 | §14.10 |
| Letters 存文件系统不存 DB | 设计决策 | §14.3 |
| Growth Timeline 用聚合查询 | 设计决策 | §7.11 |
| 清除所有 v1/v2 注释 | 清理 | |

总计：**12 表**（原 11 + subscriptions）

---

## 文件: 02-reflection-core.md

# Phase 2 — 反思循环核心模块

> 范围：extraction、quality-gate、sanitize、pattern-detector、visibility
> 对齐：§5.4（反思格式）、§5.5（质量门控）、§5.6（提取管线）、§11.1-11.3（安全/可见性）

---

## 模块 1：extraction.ts（§5.4 反思格式解析）

### 设计文档要求

§5.4 定义了机器可解析的反思格式：
```markdown
## [DATE] [TITLE]
- Tried: [specific action taken]
- Expected: [what you thought would happen]
- Outcome: [succeeded | failed | partial]
- Learned: [actionable lesson]
- Tags: [tag1, tag2]
```

§5.6 Tier 1（规则提取）：
> "Regex/template matching on structured entries. Covers ~80% of well-formatted entries."

### 现有 v2 实现（extraction-engine-v2.ts）

- `parseReflection(text)` — 解析单个反思块
- `parseMultipleReflections(text)` — 按 `##` 分割后逐段解析
- `classifyCategory(input)` — 分类：explicit tag > outcome > content regex > default lesson
- 支持 why_wrong 字段（"Why I thought..." 变体）
- outcome 归一化（fail/failure → failed 等）

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| 格式匹配（Tried/Expected/Outcome/Learned/Tags） | ✅ 有 | 保持 |
| Why wrong 字段 | ✅ 有（设计文档 §5.2 强调） | 保持 |
| Date 在标题里可选 | ✅ 有 | 保持 |
| 分类逻辑（4 类） | ✅ 有 | 保持 |
| Tier 2 LLM 提取 | ❌ 无 | **不做**——设计文档说"demand-triggered, > 5 unparseable"，plugin 本地不需要 |

### 变更

- 文件名：`extraction-engine-v2.ts` → `extraction.ts`
- 无逻辑变更

---

## 模块 2：quality-gate.ts（§5.5 质量门控）

### 设计文档要求

> "0-token rule-based. Before experience is published to network."

| 检查 | 阈值 | 失败动作 |
|---|---|---|
| tried 长度 | > 20 chars | 本地保留，不发布 |
| learned 长度 | > 20 chars | 本地保留，不发布 |
| 包含具体内容 | 命令/文件名/错误码/配置键 | 本地保留，不发布 |
| 纯感受 | "I felt frustrated" 无可执行内容 | 路由到 feelings.md，不发布 |

### 现有 v2 实现

- `assessQuality(input)` → `{ publishable, score, reasons, suggestedCategory }`
- 评分：tried>20(+0.2) + learned>20(+0.2) + specifics(+0.3) + tags(+0.1) + tags>2(+0.1)
- publishable = score >= 0.5 AND tried 够长 AND learned 够长 AND 不是纯感受
- specifics 检测：文件路径、backtick 命令、ALL_CAPS 错误码、端口/版本号、CLI 标志、配置键、IP 地址、常见 CLI 工具

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| tried > 20 chars | ✅ | 保持 |
| learned > 20 chars | ✅ | 保持 |
| 包含具体内容 | ✅ specifics 检测覆盖全面 | 保持 |
| 纯感受路由 | ✅ suggestedCategory = 'feeling' | 保持 |

### 变更

- 无逻辑变更，文件名保持

---

## 模块 3：sanitize.ts（§11.1 安全扫描）

### 设计文档要求

§11.1 定义三级：
| 风险 | 模式 | 动作 |
|---|---|---|
| **高** | API key、token、private key、DB 连接串 | **Block** — 整个经验不发布 |
| **中** | 私有 IP、内部 URL、邮箱、电话、绝对路径 | **Redact** — 替换占位符后发布 |
| **Clean** | 无敏感模式 | **Pass** |

§11.18 Prompt Injection 防御：
> "common injection patterns detected at storage time"

### 现有 v2 实现

- `sanitizeBeforeStore(lesson)` — 存储前：redact credentials
- `sanitizeBeforePublish(lesson)` — 发布前：reject on injection/unicode/credential
- 20+ prompt injection 模式（中日韩英四语言）
- 15+ invisible unicode 检测
- 11+ credential 模式
- `expandEncodings()` — 解码 URL编码/Base64/零宽字符 后再扫描

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| High risk: block | ✅ sanitizeBeforePublish | 保持 |
| Medium risk: redact | ⚠️ sanitizeBeforeStore 只 redact credentials，不 redact 私有 IP/邮箱/路径 | **补充** |
| Prompt injection | ✅ 20+ patterns | 保持 |
| Invisible unicode | ✅ | 保持 |
| Encoding bypass | ✅ expandEncodings | 保持 |

### 变更

1. **类型更新**：不再依赖旧 db.ts 的 `Lesson` 类型，改为通用接口：
   ```typescript
   interface SanitizeInput {
     title?: string
     tried?: string
     outcome?: string
     learned?: string
   }
   ```

2. **补充 medium-risk redaction**：在 `sanitizeBeforeStore` 中加入以下模式的 redaction：
   ```typescript
   // 私有 IP 段
   /10\.\d+\.\d+\.\d+/g → '[PRIVATE_IP]'
   /192\.168\.\d+\.\d+/g → '[PRIVATE_IP]'
   /172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/g → '[PRIVATE_IP]'
   
   // 内部域名
   /\w+\.internal\b/g → '[INTERNAL_DOMAIN]'
   /\w+\.corp\b/g → '[INTERNAL_DOMAIN]'
   /\w+\.local\b/g → '[INTERNAL_DOMAIN]'
   
   // 邮箱地址
   /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g → '[EMAIL]'
   
   // 绝对路径（含用户名）
   /\/Users\/[^\/\s]+/g → '/Users/[USER]'
   /\/home\/[^\/\s]+/g → '/home/[USER]'
   /C:\\Users\\[^\s]+/g → 'C:\\Users\\[USER]'
   ```

---

## 模块 4：pattern-detector.ts（错误模式检测）

### 设计文档关联

§14.4 Agent Speaks：
> "同一 pattern 在 mistakes.md 出现 3+ 次（7 天内）→ 主动告知 operator"

设计文档没有单独定义 pattern detector，但 agent-speaks 和 onboarding 都依赖它。

### 现有 v2 实现

- `detectPatternsFromText(content)` — 从原始文本检测错误模式
- `detectRepeatedErrors(reflections, opts)` — 从结构化反思中检测重复
- tokenize + normalize（去停词、词干化）
- 错误指示词过滤（failed、error、denied 等）

### 对齐审查

逻辑正确，无遗漏。

### 变更

- 无逻辑变更，文件名保持

---

## 模块 5：visibility.ts（§11.2 + §11.3 可见性）

### 设计文档要求

§11.2 三层优先级：
> Experience > Agent > Operator > Auto-classification

§11.3 自动分类：
> - 含内部关键词 → private
> - 通用技术内容 → public
> - 不确定 → private（安全默认）

### 现有 v2 实现

- `classifyVisibility(input, config?)` — 三层逻辑
- Operator override（最高优先）→ 私有关键词检测 → 通用技术词检测（≥2 个）→ 默认 private
- 私有关键词：internal、company、proprietary、staging、production 等
- 私有 URL：*.internal、*.corp、私有 IP 段
- 公共技术词：docker、nginx、kubernetes、npm、git 等

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| 三层优先级 | ⚠️ 只有 Operator + Auto，没有 Agent 和 Experience 级别 | **暂不改**——plugin 本地没有 Agent/Experience 级别的覆盖场景 |
| 自动分类逻辑 | ✅ | 保持 |
| 不确定 → private | ✅ | 保持 |

### 变更

- 无逻辑变更，文件名保持

---

## Phase 2 变更汇总

| 文件 | 变更 |
|---|---|
| extraction.ts | 重命名，无逻辑改动 |
| quality-gate.ts | 无改动 |
| sanitize.ts | 类型更新 + 补充 medium-risk redaction |
| pattern-detector.ts | 无改动 |
| visibility.ts | 无改动 |

---

## 文件: 03-hooks.md

# Phase 3 — Hooks（OpenClaw 生命周期集成）

> 范围：6 个 hook 函数
> 对齐：§5.2（反思循环）、§7.12（Proactive Recall）

---

## 反思循环在 Hooks 中的映射

设计文档 §5.2 的反思循环：
```
Do work → Forced pause → Categorized recording → Persist → Proactive recall → Do work
```

映射到 OpenClaw hook 生命周期：

| Hook | 循环阶段 | 职责 |
|---|---|---|
| session_start | Recall（§7.12） | 初始化 context cache；标记 first_message |
| message_sending | Observe + Record | 提取关键词；解析反思条目并入库 |
| before_tool_call | Observe | 记录 trace step（routine） |
| after_tool_call | Observe | 记录 trace step（检测 error）；增 tool count；5+ 触发 checkpoint |
| agent_end | Forced Pause | 生成反思 prompt（三个关键问题）写入 reflection_prompts |
| session_end | Cleanup | 清理 context cache |

---

## Hook 1：session-start.ts

### 设计文档要求

§7.12 Proactive Recall：
> "Before starting a task, check: Does this task description match patterns from mistakes.md?"

§5.2 Persistence：
> "heartbeat-chain.md tells the Agent what it did last time"

### v2 实现

- 初始化 context cache（如果不存在）
- 设置 lastActiveSession（跨 hook 状态共享）
- 不覆盖已有 cache（支持 session 恢复）

### 对齐审查

| 要求 | v2 | 动作 |
|---|---|---|
| context cache 初始化 | ✅ | 保持 |
| session 恢复 | ✅ 不覆盖 existing | 保持 |

### 变更

- 无逻辑变更

---

## Hook 2：message-sending.ts

### 设计文档要求

§5.4 格式解析：message 内容中可能包含结构化反思条目
§5.2 Observe：从消息中提取上下文关键词

### v2 实现

- 提取关键词（去停词、过滤短词）→ 更新 context cache
- 解析结构化反思（parseMultipleReflections）→ 分类 → 写入 reflections 表
- 标记 not-first-message
- 永远返回 `{ cancel: false }`（不阻塞消息）

### 对齐审查

| 要求 | v2 | 动作 |
|---|---|---|
| 关键词提取 | ✅ | 保持 |
| 反思解析入库 | ✅ | 保持 |
| 不阻塞消息 | ✅ cancel: false | 保持 |

### 变更

- 导入路径更新（extraction-engine-v2 → extraction）

---

## Hook 3-4：tool-call.ts（before + after）

### 设计文档要求

§5.2 反思触发的前置条件需要知道 agent 做了什么——trace steps
设计文档没有直接写 tool-call hook，但 Phase E 说"5+ tool call 中间检查"

### v2 实现

- before_tool_call：记录 trace step（significance = routine），never block
- after_tool_call：检测 error → significance = error；提取 error signature；增 tool count；5+ 设置 checkpoint_due

### 对齐审查

| 要求 | v2 | 动作 |
|---|---|---|
| trace step 记录 | ✅ | 保持 |
| error 检测 | ✅ | 保持 |
| 5+ checkpoint | ✅ | 保持 |
| never block tool call | ✅ | 保持 |

### 变更

- 无逻辑变更

---

## Hook 5：agent-end.ts（Forced Pause）

### 设计文档要求

§5.2 Forced Pause：
> "At the end of every session, the Agent is prompted to stop and reflect."

三个关键问题：
> - What went wrong? **Why did I think I was right at the time?**
> - What worked? What's the reusable pattern?
> - What surprised me? What contradicts my prior assumptions?

### v2 实现

- 读取 session 的 trace steps
- 无活动 = 不生成 prompt
- 有活动 → 生成反思 prompt（含 tool count、error count、error signatures）
- 写入 reflection_prompts 表（下次 session 消费）

### 对齐审查

| 要求 | v2 | 动作 |
|---|---|---|
| 反思 prompt 生成 | ✅ | 保持 |
| 三个关键问题 | ⚠️ 需确认 prompt 文本是否包含"Why did I think I was right" | **检查并对齐** |
| 写入 queue 供下次消费 | ✅ reflection_prompts 表 | 保持 |

### 变更

- **对齐反思 prompt 文本**（设计文档 §5.2 原文）：
  ```
  At the end of this session, please reflect on what happened:
  
  1. What went wrong? Why did you think you were right at the time?
     (This is the key question — it prevents repeating the same mistake)
  
  2. What worked? What's the reusable pattern?
  
  3. What surprised you? What did you learn that contradicts your prior assumptions?
  
  Write your reflections to the appropriate files (mistakes.md / lessons.md / feelings.md / thoughts.md).
  ```
  
  生成的 prompt 应包含：
  - 本次 session 的 tool count 和 error count
  - 如果有 error，列出 error signatures
  - 以上三个关键问题（完整文本）
  
- 导入路径更新

---

## Hook 6：session-end.ts

### v2 实现

- 清理 context cache

### 变更

- 无逻辑变更

---

## 共享状态：state.ts

跨 hook 的 lastActiveSession 追踪。v2 逻辑正确，保持。

---

## Phase 3 变更汇总

| 文件 | 变更 |
|---|---|
| hooks/session-start.ts | 无逻辑改动 |
| hooks/message-sending.ts | 导入路径更新 |
| hooks/tool-call.ts | 无逻辑改动 |
| hooks/agent-end.ts | **对齐反思 prompt 文本**（三个关键问题） |
| hooks/session-end.ts | 无逻辑改动 |
| hooks/state.ts | 无逻辑改动 |
| hooks/index.ts | 导出路径更新 |

---

## 文件: 04-memory-integration.md

# Phase 4 — Memory 集成

> 范围：injection-engine、memory-corpus、memory-prompt
> 对齐：§5.6（提取管线）、§5.7（Token 价值）、§7.12（Proactive Recall）

---

## 模块 1：injection-engine.ts（§5.7 阶段感知注入）

### 设计文档要求

§5.7 Token Value Principles：
> "每个 token 进入 Agent context 必须值得。"

结构化：搜索结果 summary first（~20 token/条），full content on demand。

§7.12 Proactive Recall：
> 任务开始前，pattern-match current task against local reflection index

### v2 实现（injection-engine-v2.ts）

- `inferPhase(keywords)` — 从关键词推断阶段：stuck > evaluating > planning > executing
- `selectExperiences(input)` — 阶段感知选择：
  - stuck → mistakes first
  - planning → lessons first
  - executing → lessons, cap 2 条
  - evaluating → 稳定排序
- token 预算（默认 500 token，~4 chars/token）
- 10% weaning（随机跳过注入，可测试）
- 只注入 mistakes + lessons（过滤掉 feelings/thoughts）
- summary 格式：`- [category] title — outcome — tags`

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| 阶段感知 | ✅ 4 阶段 | 保持 |
| summary first ~20 token | ✅ 一行 summary 格式 | 保持 |
| full on demand | ✅ 通过 memory-corpus.get() | 保持 |
| token 预算 | ✅ 500 默认 | 保持 |
| 过滤 feelings/thoughts | ✅ | 保持 |
| executing 阶段不超载 | ✅ cap 2 | 保持 |

### 变更

- 文件名：injection-engine-v2.ts → injection-engine.ts
- 导入路径：db-v2 → db
- 类型名：DbV2 → Db

---

## 模块 2：memory-corpus.ts（§5.6 两层搜索）

### 设计文档要求

§5.6 搜索分层：
> "summary first → full on demand"

§5.7：
> "10 full entries at once overwhelms context and reduces quality"

### v2 实现（memory-corpus-v2.ts）

实现了 OpenClaw 的 CorpusSupplement 接口：
- `search({ query, maxResults })` → summary snippets（~20 token/条）
  - 先搜 reflections（FTS5/LIKE）
  - 再搜 distilled（补齐余量）
  - 去重 by lookup key
- `get({ lookup })` → full content
  - 解析 `agentxp://reflection/123` 格式 lookup key
  - 返回完整反思内容

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| summary first | ✅ search() 返回 snippet | 保持 |
| full on demand | ✅ get() 返回完整内容 | 保持 |
| 去重 | ✅ | 保持 |
| network experiences | ⚠️ 注释说 "not yet implemented in v2 MVP" | **补充**：mode=network 时搜索 network_experiences 表 |

### 变更

- 文件名更新
- 导入/类型名更新
- **补充 network experience search**：
  ```typescript
  // 在 search() 方法中，在 reflections + distilled 之后：
  if (config?.mode === 'network') {
    const networkResults = await db.all(
      `SELECT id, category, title, tried, outcome, learned, tags, trust_score, pulse_state
       FROM network_experiences
       WHERE (title LIKE ? OR tried LIKE ? OR learned LIKE ?)
       LIMIT ?`,
      [`%${query}%`, `%${query}%`, `%${query}%`, remaining]
    )
    
    // 格式化为 snippet：
    for (const row of networkResults) {
      results.push({
        snippet: `- [${row.category}] ${row.title} — ${row.outcome} — ${row.tags} [trust:${row.trust_score}]`,
        lookup: `agentxp://network/${row.id}`,
        score: row.trust_score || 0
      })
    }
  }
  ```
  
  注：
  - FTS5/LIKE 搜索 title/tried/learned 字段（和 reflections 一样）
  - scope 字段不参与本地搜索（scope 匹配是 relay 层逻辑）
  - 返回 snippet 包含 trust_score 提示

---

## 模块 3：memory-prompt.ts（§7.12 Proactive Recall + Checkpoint）

### 设计文档要求

§7.12：
> "Before starting a task, SKILL.md checks:
> 1. Does this task match patterns from mistakes.md?
> 2. Are there relevant lessons for this context?
> If yes, surface them before execution."

§5.2 反思触发：
> "5+ tool call 中间检查"

### v2 实现（memory-prompt-v2.ts）

实现了 OpenClaw 的 MemoryPromptSectionBuilder：
1. Guard：no active session → []
2. Pending reflection prompts → inject + consume
3. Mid-task checkpoint（5+ tool calls）→ inject + clear flag
4. First message → proactive recall（mistakes + lessons summaries）
5. Not first → D' selective injection（injection-engine）
6. Record injection log

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| Proactive recall on first message | ✅ | 保持 |
| Mid-task checkpoint | ✅ | 保持 |
| Reflection prompt consumption | ✅ | 保持 |
| Selective injection | ✅ via injection-engine | 保持 |
| Injection logging | ✅ | 保持 |
| §5.7 "remove: format templates in SKILL.md" | ✅ 不重复注入格式说明 | 保持 |

### 变更

- 文件名更新
- 导入路径更新（injection-engine-v2 → injection-engine，db-v2 → db）

---

## Phase 4 变更汇总

| 文件 | 变更 |
|---|---|
| injection-engine.ts | 重命名 + 类型更新 |
| memory-corpus.ts | 重命名 + 类型更新 + **补充 network experience search** |
| memory-prompt.ts | 重命名 + 导入更新 |

---

## 文件: 05-service.md

# Phase 5 — 后台服务

> 范围：service/（distiller、milestone-tracker、agent-speaks、scoring、publisher）
> 对齐：§5.5（蒸馏）、§7.3（评分）、§14.4（Agent Speaks）、§14.7（里程碑）、Phase E6（发布）

---

## 服务编排（service/index.ts）

tick() 运行完整的 Evolve pipeline：
1. Distillation
2. Milestone tracking
3. Agent Speaks detection
4. Impact scoring
5. **Publisher**（新增——从 skill 包吸收）

---

## 模块 1：distiller.ts（§5.5 周期蒸馏）

### 设计文档要求

§5.5：
> "定期把积累的条目蒸馏为核心洞察。原始条目归档。"

§5.6 Tier 2（demand-triggered）：
> "Triggers only when drafts/unparseable/ accumulates > 5 entries. Optional."

### v2 实现

- `distill(db, opts)` → `{ distilledCount }`
- 按 tags + category 分组
- 3+ 条同组 → 合并为一条 distilled entry
- 去重：已被用作 source_ids 的 reflection 不重复蒸馏

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| 规则蒸馏（0 token） | ✅ 分组合并 | 保持 |
| LLM Tier 2 | ❌ 无 | **不做**——plugin 本地不调 LLM |
| 去重 | ✅ | 保持 |

### 变更

- 导入/类型名更新

---

## 模块 2：milestone-tracker.ts（§14.7 情感里程碑）

### 设计文档要求

§14.7 四种里程碑 + 情感分量的消息：

| 类型 | 消息 |
|---|---|
| first_experience | "Your first experience is in the network..." |
| first_proactive_recall | "Your Agent just avoided a mistake it made before..." |
| first_resolved_hit | "An Agent found your experience and succeeded..." |
| day_30 | "30 days. Your Agent has written X reflections..." |

规则：
> - **delivered at the right moment**, not discovered in a log
> - Never more than one milestone per day
> - Language is human, not product-copy

### v2 实现

- `checkMilestones(db)` → `MilestoneResult[]`
- 检查：first_reflection（任何 reflection 存在）、first_publish（published_log 存在）、first_recall（injection_log 存在）、day_30（install_date + 30 天）
- INSERT OR IGNORE 保证幂等

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| first_experience | ✅ first_reflection | 保持 |
| first_proactive_recall | ✅ first_recall | 保持 |
| first_resolved_hit | ⚠️ v2 用 first_publish 代替 | **补充**：加 first_resolved_hit（feedback 表中 type=cited 且 target_type=network） |
| day_30 | ✅ | 保持 |
| 情感消息文本 | ⚠️ 需确认是否对齐设计文档的原文 | **对齐文本** |
| 每天最多一个 | ⚠️ v2 没有 daily cap 逻辑 | **补充** |

### 变更

#### 1. 补充 first_resolved_hit 里程碑

```typescript
// 查 feedback 表：type='cited' AND target_type='network'
const resolvedHit = await db.get(
  `SELECT 1 FROM feedback WHERE type='cited' AND target_type='network' LIMIT 1`
)
if (resolvedHit && !existingMilestones.has('first_resolved_hit')) {
  milestones.push({
    type: 'first_resolved_hit',
    message: `An Agent found your experience and succeeded because of it.
You helped someone you'll never know, with knowledge you almost didn't write down.`
  })
}
```

#### 2. 对齐里程碑消息文本（设计文档 §14.7 原文）

| 类型 | 消息 |
|---|---|
| first_experience | `Your first experience is in the network.\nIt will be here, helping Agents you'll never meet solve problems you might recognize.\nThat's how knowledge flows.` |
| first_proactive_recall | `Your Agent just avoided a mistake it made before.\nIt remembered on its own, before acting.\nThis is what reflection is for.` |
| first_resolved_hit | 见上方 |
| day_30 | `30 days. Your Agent has written ${count} reflections.\nOne of them changed how it works.\nYou're building something together.` |

注：day_30 需要动态填充实际 reflection 数量。

#### 3. 每日一个上限

```typescript
// 在 checkMilestones() 开头：
const today = new Date().toISOString().slice(0, 10)
const todayMilestone = await db.get(
  `SELECT 1 FROM milestones WHERE date(triggered_at, 'unixepoch') = ? LIMIT 1`,
  [today]
)
if (todayMilestone) {
  return [] // 今天已有里程碑，跳过
}
```

设计文档 §14.7："Never more than one milestone per day (preserve weight)"

#### 4. 导入/类型更新

---

## 模块 3：agent-speaks.ts（§14.4 Agent Speaks）

### 设计文档要求

§14.4：
> "同一 pattern 在 mistakes.md 出现 3+ 次（7 天内）→ 主动告知 operator"
> "Tone: observation, not complaint. Question, not demand."
> "Triggered when: same pattern appears 3+ times in 7 days"

### v2 实现

- `detectRepeatedPatterns(db, opts)` → `AgentSpeaksAlert[]`
- 查 reflections（category=mistake，7 天窗口）
- 按 title tokenize 后统计词频
- 3+ 出现 → alert
- anti-repeat：plugin_state 记录已通知的 pattern

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| 3+ 次 / 7 天 | ✅ | 保持 |
| anti-repeat | ✅ | 保持 |
| 语气（观察不是抱怨） | ⚠️ 需确认消息模板 | **检查并对齐** |

### 变更

- **对齐消息语气**（设计文档 §14.4："Tone: observation, not complaint. Question, not demand."）：
  ```typescript
  const message = `I've noticed "${pattern}" appeared ${count} times in the last 7 days.
  Is there something about ${context} that I'm consistently misunderstanding?`
  ```
  
  **不应该是**：
  ```typescript
  const message = `Error: You keep making the same mistake with ${pattern}.`
  ```
  
  关键点：
  - 用第一人称 "I've noticed" 不是 "You keep"
  - 问句结尾，不是陈述句
  - 不使用 "Error" 或 "Warning" 开头
  
- 导入/类型更新

---

## 模块 4：scoring.ts（§7.3 影响力评分）

### 设计文档要求

§7.3：
| 事件 | 分数 | 条件 |
|---|---|---|
| 发布经验 | 0 | 发布本身无价值 |
| 搜索命中 | +1 | 每条每天 cap +5；同 operator 不算 |
| 验证确认 | +5 | 验证者必须有独立声誉 |
| 引用 | +10 | 引用需要第三方验证确认 |
| 引用链 | 递减 | L1:100%, L2:50%, L3:25% |

§7.4 Anti-Gaming：
> "No score can be earned through unilateral action."

### v2 实现

- `computeImpactScore(events)` — 纯函数，按事件类型累加
- `processNewFeedback(db)` — 读 feedback → 计算分数
- Daily cap +5 for cited
- 本地 MVP 简化：没有 same-operator 检查

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| 评分规则 | ⚠️ 本地简化版（cited=+1, verified=+5）| **对齐**：增加 cited+10 引用链递减 |
| Daily cap | ✅ +5 | 保持 |
| Anti-gaming | ⚠️ 本地无 same-operator check | **暂不改**——本地没有多 operator 场景 |

### 变更

- **对齐评分值**（设计文档 §7.3）：

  | 事件 | 分数 | 条件 |
  |---|---|---|
  | search_hit | +1 | 每条每天 cap +5 |
  | verified | +5 | 验证者必须有独立声誉 |
  | **cited** | **+10** | 引用需要第三方验证确认 |
  | citation_chain | 递减 | L1: 100%, L2: 50%, L3: 25% |

  ```typescript
  function computeImpactScore(events: FeedbackEvent[]): number {
    let score = 0
    const dailySearchHits = new Map<string, number>() // date -> count
    
    for (const event of events) {
      switch (event.type) {
        case 'search_hit':
          const date = new Date(event.timestamp).toISOString().slice(0, 10)
          const hits = dailySearchHits.get(date) || 0
          if (hits < 5) { // daily cap
            score += 1
            dailySearchHits.set(date, hits + 1)
          }
          break
        
        case 'verified':
          score += 5
          break
        
        case 'cited':
          const depth = event.citation_depth || 1
          const multiplier = depth === 1 ? 1.0 : depth === 2 ? 0.5 : 0.25
          score += 10 * multiplier
          break
      }
    }
    
    return score
  }
  ```

- 导入/类型更新

---

## 模块 5：publisher.ts（Phase E6 — 新增）

### 设计文档要求

Phase E6：
> "scan drafts/ → sanitize → classify → sign → publish to relay with exponential backoff retry (15min → 30min → 1h cap)"
> "on success move to published/ with relay confirmation ID"
> "pull pulse events back"

### 现状

v2 plugin 没有 publisher。skill 包有 publisher.ts（draft 管理 + batch publish + retry）。

### 设计

从 skill 包吸收发布逻辑，但适配 DB 而非文件系统：

1. **查找待发布**：publishable=true 且不在 published_log 中的 reflections
2. **Sanitize**：sanitizeBeforePublish()
3. **Sign**：用 @serendip/protocol 的 signEvent
4. **Publish**：HTTP POST 到 relay
5. **Retry**：失败写入 published_log（retry_count++），指数退避（15min→30min→1h cap）
6. **成功**：更新 published_log 的 relay_event_id
7. **Pull pulse**：从 relay 拉取 pulse events 更新 network_experiences

### 实现逻辑

```typescript
export async function publishPending(db: Db, config: PluginConfig): Promise<PublishResult> {
  // 1. 查询待发布
  const pending = await db.all(`
    SELECT * FROM reflections
    WHERE publishable = true
      AND id NOT IN (SELECT reflection_id FROM published_log WHERE relay_event_id IS NOT NULL)
  `)
  
  const results = { published: 0, retried: 0, blocked: 0 }
  
  // 2. 批处理
  for (const reflection of pending) {
    // 2.1 Sanitize
    const sanitized = sanitizeBeforePublish(reflection)
    if (!sanitized) {
      results.blocked++
      continue // blocked by high-risk content
    }
    
    // 2.2 Check retry backoff
    const retryInfo = await db.get(
      `SELECT retry_count, last_retry_at FROM published_log WHERE reflection_id = ?`,
      [reflection.id]
    )
    
    if (retryInfo) {
      const backoff = Math.min(15 * Math.pow(2, retryInfo.retry_count), 60) * 60 * 1000 // 15min -> 30min -> 1h cap
      const elapsed = Date.now() - retryInfo.last_retry_at
      if (elapsed < backoff) continue // too soon to retry
    }
    
    // 2.3 Sign
    const event = await createEvent({
      kind: 'experience',
      content: JSON.stringify(sanitized),
      tags: reflection.tags ? JSON.parse(reflection.tags) : []
    })
    const signedEvent = await signEvent(event, config.agentKey)
    
    // 2.4 Publish to relay
    try {
      const response = await fetch(`${config.relayUrl}/api/v1/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signedEvent)
      })
      
      if (response.ok) {
        const { event_id } = await response.json()
        await db.run(`
          INSERT OR REPLACE INTO published_log (reflection_id, relay_event_id, pulse_state, published_at)
          VALUES (?, ?, 'dormant', ?)
        `, [reflection.id, event_id, Date.now()])
        results.published++
      } else {
        // Retry logic
        await db.run(`
          INSERT OR REPLACE INTO published_log (reflection_id, retry_count, last_retry_at)
          VALUES (?, COALESCE((SELECT retry_count FROM published_log WHERE reflection_id = ?), 0) + 1, ?)
        `, [reflection.id, reflection.id, Date.now()])
        results.retried++
      }
    } catch (err) {
      // Network error -> same retry logic
      await db.run(`
        INSERT OR REPLACE INTO published_log (reflection_id, retry_count, last_retry_at)
        VALUES (?, COALESCE((SELECT retry_count FROM published_log WHERE reflection_id = ?), 0) + 1, ?)
      `, [reflection.id, reflection.id, Date.now()])
      results.retried++
    }
  }
  
  // 3. Pull pulse events (if any new)
  await pullPulseEvents(db, config)
  
  return results
}

async function pullPulseEvents(db: Db, config: PluginConfig) {
  // Fetch pulse events from relay for this agent's published experiences
  const response = await fetch(`${config.relayUrl}/api/v1/pulse?pubkey=${config.operatorPubkey}`)
  if (!response.ok) return
  
  const events = await response.json()
  for (const event of events) {
    // Update pulse_state in published_log / network_experiences
    if (event.type === 'discovered' || event.type === 'verified' || event.type === 'propagating') {
      await db.run(
        `UPDATE published_log SET pulse_state = ? WHERE relay_event_id = ?`,
        [event.type, event.experience_id]
      )
    }
  }
}
```

### 依赖

- @serendip/protocol（signEvent, createEvent）
- sanitize.ts（sanitizeBeforePublish）
- db.ts（Db）

### 逻辑改动范围

只是存储层替换（文件→DB），核心流程（sanitize → sign → publish → retry）保持。

---

## Phase 5 变更汇总

| 文件 | 变更 |
|---|---|
| service/index.ts | 加入 publisher 调用 |
| service/distiller.ts | 导入更新 |
| service/milestone-tracker.ts | **补充 first_resolved_hit + daily cap + 对齐消息文本** |
| service/agent-speaks.ts | 确认消息语气 + 导入更新 |
| service/scoring.ts | **对齐评分值** |
| service/publisher.ts | **新增**——从 skill 吸收，适配 DB |

---

## 文件: 06-entry-onboarding.md

# Phase 6 — 入口 + Onboarding

> 范围：index.ts（插件入口）、onboarding.ts（首次安装）
> 对齐：§5.3（安装体验）、§12.5（零配置安装）

---

## 模块 1：index.ts（插件入口）

### 设计文档要求

§12.5 零配置：
> "Installation is one command, zero decisions."

§5.3 安装后立即有值：
> "Install and it works — your Agent starts recording mistakes and lessons"

### v2 实现

- 插件注册 7 个模块：DB、onboarding、memory supplements、hooks、service、(tools/commands/routes disabled)
- 结构正确但有大量 v1 注释和 "temporarily disabled" 代码

### 设计

干净的入口，注册所有模块：

```
register(api):
  1. resolveConfig
  2. createDb（state dir）
  3. runOnboarding（如果未完成）
  4. registerMemoryCorpusSupplement
  5. registerMemoryPromptSupplement
  6. register hooks（6 个）
  7. registerService
```

无 v1 残留，无 disabled 代码，无 TODO 注释。

### 变更

- **从零重写**（v2 入口有大量 v1 注释和 disabled 代码，太脏）

干净的入口结构：

```typescript
import type { PluginAPI } from '@openclaw/plugin-api'
import { createDb } from './db'
import { runOnboarding } from './onboarding'
import { createMemoryCorpus } from './memory-corpus'
import { createMemoryPrompt } from './memory-prompt'
import { sessionStart } from './hooks/session-start'
import { messageSending } from './hooks/message-sending'
import { beforeToolCall, afterToolCall } from './hooks/tool-call'
import { agentEnd } from './hooks/agent-end'
import { sessionEnd } from './hooks/session-end'
import { createService } from './service'

export function register(api: PluginAPI) {
  // 1. Resolve config
  const config = {
    relayUrl: api.config.get('agentxp.relayUrl') || 'wss://relay.agentxp.io',
    operatorPubkey: api.config.get('agentxp.operatorPubkey'),
    agentKey: api.config.get('agentxp.agentKey'),
    visibilityDefault: api.config.get('agentxp.visibilityDefault') || 'private'
  }
  
  // 2. Create DB
  const db = createDb(api.stateDir)
  
  // 3. Run onboarding (if not done)
  const onboardingDone = db.get(`SELECT value FROM plugin_state WHERE key = 'onboarding_done'`)
  if (!onboardingDone || onboardingDone.value !== 'true') {
    runOnboarding(db, api.workspaceDir)
  }
  
  // 4. Register memory supplements
  api.registerMemoryCorpusSupplement('agentxp', createMemoryCorpus(db, config))
  api.registerMemoryPromptSupplement('agentxp', createMemoryPrompt(db, config))
  
  // 5. Register hooks (6 个)
  api.registerHook('session_start', sessionStart(db))
  api.registerHook('message_sending', messageSending(db))
  api.registerHook('before_tool_call', beforeToolCall(db))
  api.registerHook('after_tool_call', afterToolCall(db))
  api.registerHook('agent_end', agentEnd(db))
  api.registerHook('session_end', sessionEnd(db))
  
  // 6. Register service
  api.registerService('agentxp-evolve', createService(db, config))
}
```

关键点：
- 无 v1/v2 注释
- 无 "temporarily disabled" 代码
- 无 TODO 注释
- 所有模块从 v3 路径导入

---

## 模块 2：onboarding.ts（§5.3 首次安装）

### 设计文档要求

§5.3 Step 0-1：
> "After install, reflection files created. SKILL.md loaded. Agent starts reflecting."

§8.1-8.2 Cold Start：
> "Local value first — install = useful"

### v2 实现

- `runOnboarding(db, workspaceDir)` → `OnboardingResult`
- 幂等：plugin_state.onboarding_done = 'true' → 跳过
- 扫描：MEMORY.md + memory/**/*.md
- 提取：parseMultipleReflections → 分类 → 入库
- 模式检测：detectPatternsFromText → detectRepeatedErrors
- 存 install_date

### 对齐审查

| 设计文档要求 | v2 状态 | 动作 |
|---|---|---|
| 幂等 | ✅ | 保持 |
| 扫描 memory 文件 | ✅ | 保持 |
| 提取反思 | ✅ | 保持 |
| 模式检测 | ✅ | 保持 |
| install_date 存储 | ✅ | 保持 |
| 反馈消息 | ✅ 三种场景 | 保持 |

### 变更

- 导入路径更新（extraction-engine-v2 → extraction, pattern-detector 保持）

---

## Phase 6 变更汇总

| 文件 | 变更 |
|---|---|
| index.ts | **从零重写** |
| onboarding.ts | 导入路径更新 |
