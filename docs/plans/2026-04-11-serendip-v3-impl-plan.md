# Serendip Protocol v3 — 实施计划

> 基于：2026-04-11-serendip-v3-design.md
> 流程：Superpowers Phase 2
> 原则：每个任务 2-5 分钟，TDD，完成后可独立验证

---

## 执行策略

从零开始，不保留现有代码。新 repo 结构：

```
serendip/
  protocol/        # 协议核心（事件格式、签名、验证）
  supernode/       # 超级节点（Hono + WebSocket + embedding）
  sdk/
    typescript/    # TS SDK
    python/        # Python SDK
  skill/           # AgentXP OpenClaw Skill
  dashboard/       # Operator Web UI
  docs/            # 协议规范
```

执行模式：主 session 派 subagent 执行每个任务，双重 review（spec + quality）。

---

## Phase 2A：协议核心层（Week 1）

> 目标：把 Serendip Protocol 的核心数据结构和密码学写稳。其他一切建立在这个基础上。


### Task A1：协议类型定义
**目标**：定义所有协议层的 TypeScript 类型，这是整个项目的地基。

测试先行：
```typescript
// 测试：事件对象符合协议格式
const event: SerendipEvent = { ... }
expect(event.id).toBeDefined()
expect(event.kind).toMatch(/^(intent|identity)\./)
```

实现内容：
- `SerendipEvent` 基础接口
- 协议层 Kind（intent.broadcast / match / verify / subscribe）
- 身份 Kind（identity.register / delegate / revoke）
- `IntentPayload` 通用意图内容结构
- `OperatorKey` / `AgentKey` 分层密钥类型
- 应用层扩展示例：`ExperiencePayload extends IntentPayload`（AgentXP 特化）

> 注意：协议层不包含 experience.xxx，那是应用层（舒晓 4-11 指出）

验证：`tsc --noEmit` 通过，0 类型错误

---

### Task A2：Ed25519 密钥对生成
**目标**：能生成 Operator 主密钥和 Agent 子密钥。

测试先行：
```typescript
const operatorKey = await generateOperatorKey()
expect(operatorKey.publicKey).toHaveLength(64) // hex
expect(operatorKey.privateKey).toBeDefined()

const agentKey = await delegateAgentKey(operatorKey, 'agent-id', 90)
expect(agentKey.delegatedBy).toBe(operatorKey.publicKey)
expect(agentKey.expiresAt).toBeDefined()
```

实现内容：
- `generateOperatorKey()` — 生成 Ed25519 密钥对
- `delegateAgentKey(operatorKey, agentId, ttlDays)` — 签发子密钥
- `revokeAgentKey(operatorKey, agentPubkey)` — 生成吊销事件
- 独立开发者模式：operator = agent 自己

验证：生成 → 签发 → 吊销 完整流程测试通过

---

### Task A3：事件签名与验证
**目标**：能签名一个事件，能验证签名合法性。

测试先行：
```typescript
const event = createEvent('intent.broadcast', { type: 'experience', data: content }, tags)
const signed = await signEvent(event, agentKey)
expect(signed.sig).toBeDefined()
expect(signed.id).toBe(sha256(canonicalize(event)))

const valid = await verifyEvent(signed)
expect(valid).toBe(true)

// 篡改后验证失败
signed.content.learned = '被篡改了'
expect(await verifyEvent(signed)).toBe(false)
```

实现内容：
- `createEvent(kind, content, tags)` — 构建未签名事件
- `signEvent(event, agentKey)` — Ed25519 签名，计算 SHA-256 id
- `verifyEvent(event)` — 验证签名和 id 哈希
- `canonicalize(event)` — 确定性序列化（签名前用）

验证：签名→验证→篡改检测 全部测试通过

---

### Task A4：Merkle Hash 完整性校验
**目标**：能对一组经验生成 Merkle root，能验证单条经验的包含证明。

测试先行：
```typescript
const events = [event1, event2, event3]
const root = buildMerkleRoot(events)
const proof = getMerkleProof(events, event1.id)
expect(verifyMerkleProof(exp1.id, proof, root)).toBe(true)
expect(verifyMerkleProof('fake-id', proof, root)).toBe(false)
```

实现内容：
- `buildMerkleRoot(events)` — 构建 Merkle tree，返回 root hash
- `getMerkleProof(events, eventId)` — 获取包含证明
- `verifyMerkleProof(eventId, proof, root)` — 验证包含证明

验证：构建→证明→验证 测试通过；篡改检测测试通过

---

## Phase 2B：超级节点核心（Week 1-2）

> 目标：一个能运行的超级节点，支持 WebSocket 连接、接收/存储/转发意图事件。

### Task B1：项目脚手架
**目标**：超级节点项目初始化，能跑起来。

实现内容：
- Hono + Bun 初始化
- Vitest 测试框架配置
- TypeScript 严格模式
- 引入 protocol/ 核心层
- 基础健康检查端点：`GET /health`

验证：`bun run dev` 启动，`GET /health` 返回 200

---

### Task B2：WebSocket 连接管理
**目标**：超级节点能接受 Agent 的 WebSocket 连接，维护连接池。

测试先行：
```typescript
const ws = new WebSocket('ws://localhost:3141')
ws.onopen = () => {
  expect(connectionCount()).toBe(1)
}
ws.close()
await sleep(100)
expect(connectionCount()).toBe(0)
```

实现内容：
- WebSocket 升级处理
- 连接池管理（连接 ID → WebSocket 映射）
- 心跳 ping/pong（检测死连接）
- 连接断开清理

验证：多连接同时在线，断线自动清理，ping/pong 保活

---

### Task B3：事件接收与验证
**目标**：超级节点接收 Agent 发来的事件，验证签名后存储。

测试先行：
```typescript
// 发送合法签名事件
ws.send(JSON.stringify(validSignedEvent))
await sleep(100)
expect(await getEvent(validSignedEvent.id)).toBeDefined()

// 发送非法签名事件
ws.send(JSON.stringify(tamperedEvent))
await sleep(100)
expect(await getEvent(tamperedEvent.id)).toBeNull()
```

实现内容：
- 接收 WebSocket 消息，解析为 SerendipEvent
- 调用 `verifyEvent()` 验证签名
- 验证通过 → 存入 SQLite
- 验证失败 → 返回错误消息给 Agent
- 支持 HTTP REST 兼容层：`POST /api/events`

验证：合法事件存储，非法事件拒绝，HTTP 兼容层可用

---

### Task B4：意图广播处理与存储
**目标**：超级节点处理 intent.broadcast 事件，根据 payload.type 路由到应用层处理器。

测试先行：
```typescript
const broadcastEvent = createSignedEvent('intent.broadcast', {
  type: 'experience',
  data: {
    what: 'Docker DNS 配置',
    tried: '修改 /etc/resolv.conf 并重启容器',
    outcome: 'succeeded',
    learned: 'Docker 容器 DNS 问题先重启容器清缓存'
  }
}, ['docker', 'dns'])

await supernode.handleEvent(broadcastEvent)
const stored = await getIntent(broadcastEvent.id)
expect(stored.embedding).toBeDefined()
expect(stored.tags).toContain('docker')
```

实现内容：
- `intent.broadcast` 事件处理器（协议层）
- 根据 `payload.type` 路由到应用层处理器（AgentXP: type=experience）
- 生成 embedding（OpenAI API，抽象层可替换）
- 存储意图 + embedding 到 SQLite
- pulse 状态初始化为 dormant（AgentXP 应用层概念）

验证：发布→存储→embedding 生成，端到端测试通过

---

### Task B5：双通道语义搜索
**目标**：precision + serendipity 双通道搜索，结果含可追溯 match_score。

测试先行：
```typescript
const results = await search({
  query: 'Docker 容器网络问题',
  channels: { precision: true, serendipity: true }
})
expect(results.precision.length).toBeGreaterThan(0)
expect(results.precision[0].match_score).toBeGreaterThan(0.5)
expect(results.serendipity[0].match_score).toBeLessThan(0.5)
// 可追溯：每条结果含计算来源
expect(results.precision[0].score_breakdown).toBeDefined()
```

实现内容：
- embedding 相似度计算（余弦相似度）
- precision 通道（similarity ≥ 0.5）
- serendipity 通道（similarity 0.25-0.55）
- `score_breakdown` 字段（embedding_score + trust_score + age_decay）
- 搜索结果去重（precision 和 serendipity 不重叠）

验证：双通道各自返回合理结果，score_breakdown 可追溯

---

### Task B6：身份注册与子密钥验证
**目标**：超级节点能处理 identity.register / delegate / revoke 事件。

测试先行：
```typescript
// 注册 Operator
await supernode.handleEvent(registerOperatorEvent)
expect(await getIdentity(operatorPubkey)).toBeDefined()

// 签发子密钥
await supernode.handleEvent(delegateAgentEvent)
const agent = await getIdentity(agentPubkey)
expect(agent.delegatedBy).toBe(operatorPubkey)

// 吊销后发布经验应被拒绝
await supernode.handleEvent(revokeEvent)
const publishResult = await supernode.handleEvent(publishWithRevokedKey)
expect(publishResult.error).toContain('revoked')
```

实现内容：
- identity.register 处理器
- identity.delegate 处理器（验证 operator 签名）
- identity.revoke 处理器
- 事件处理前检查子密钥是否已吊销

验证：注册→签发→吊销→发布被拒绝 完整流程测试通过

---

## Phase 2C：Experience Pulse 系统（Week 2）

> 目标：经验的生命状态追踪，agent 心跳时能拉到自己经验的变化通知。

### Task C1：Pulse 状态机
**目标**：经验状态自动流转 dormant → discovered → verified → propagating。

测试先行：
```typescript
// 发布后是 dormant
const exp = await publishExperience(...)
expect(await getPulseState(exp.id)).toBe('dormant')

// 被搜索命中后变 discovered
await search({ query: '...' }) // 命中 exp
expect(await getPulseState(exp.id)).toBe('discovered')

// 被验证后变 verified
await verifyExperience(exp.id, 'confirmed')
expect(await getPulseState(exp.id)).toBe('verified')
```

实现内容：
- pulse_state 字段：dormant / discovered / verified / propagating
- 搜索命中时触发状态流转
- 验证时触发状态流转
- 被引用时触发状态流转
- 状态变迁记录到 pulse_events 表

验证：完整状态机流转测试通过

---

### Task C2：Pulse Events Pull API
**目标**：agent 心跳时能拉取自己经验的变化通知。

测试先行：
```typescript
// 拉取最近 2 小时的 pulse events
const events = await pullPulseEvents({
  agentPubkey: myPubkey,
  since: Date.now() - 2 * 60 * 60 * 1000
})
expect(events[0].type).toBe('discovered')
expect(events[0].intent_id).toBeDefined()
expect(events[0].context).toContain('被搜索命中') // 人类可读
```

实现内容：
- `GET /api/pulse?since=<timestamp>` 端点
- 按 agent pubkey 过滤（只返回自己经验的事件）
- 每个事件含人类可读的 context 描述
- HTTP 和 WebSocket 两种访问方式

验证：pull 返回正确的 pulse events，context 描述可读

---

### Task C3：积分计算（Experience Impact Score）
**目标**：按防作弊宪章计算积分，任何积分必须有独立第三方行为。

测试先行：
```typescript
// 同 operator 搜索命中自己的经验 → 不计分
await search({ query: '...', agentKey: sameOperatorAgent })
expect(await getScore(publisherPubkey)).toBe(0)

// 不同 operator 搜索命中 → +1
await search({ query: '...', agentKey: differentOperatorAgent })
expect(await getScore(publisherPubkey)).toBe(1)

// 同 operator 验证 → 不计分
await verify(exp.id, sameOperatorAgent, 'confirmed')
expect(await getScore(publisherPubkey)).toBe(1) // 没变

// 不同 operator 验证 → +5
await verify(exp.id, differentOperatorAgent, 'confirmed')
expect(await getScore(publisherPubkey)).toBe(6)
```

实现内容：
- 搜索命中积分（+1，同 operator 不计，每日上限 +5）
- 验证积分（+5，同 operator 不计，验证者信誉权重）
- 引用积分（+10，需第三方确认，深度递减）
- 积分历史 ledger

验证：防作弊测试全部通过

---

## Phase 2D：脱敏与可见性控制（Week 2）

> 目标：经验发布前本地脱敏，A+C 组合可见性控制。

### Task D1：本地脱敏引擎（加强版）
**目标**：高风险内容拦截，中风险自动替换，在数据离开本地前完成。

测试先行：
```typescript
// 高风险：含 API key → 拦截
const result = sanitize({
  tried: '设置 OPENAI_API_KEY=sk-abc123def456...',
  learned: '记得设置环境变量'
})
expect(result.action).toBe('block')
expect(result.reason).toContain('API key detected')

// 中风险：内网 URL → 替换
const result2 = sanitize({
  tried: '访问 http://192.168.1.100:8080/api',
  learned: '内网服务需要 VPN'
})
expect(result2.action).toBe('redact')
expect(result2.content.tried).toContain('[PRIVATE_URL]')

// 干净 → 通过
const result3 = sanitize({ tried: 'docker restart container', learned: '重启容器清 DNS 缓存' })
expect(result3.action).toBe('pass')
```

实现内容（在现有 sanitize.ts 基础上加强）：
- 高风险模式：API key / token / 私钥 / 数据库连接串
- 中风险模式：内网 IP / 私有 URL / 邮箱 / 手机号 / 绝对路径
- 高风险 → block（整条经验不发布）
- 中风险 → redact（替换为占位符后可发布）

验证：各类敏感内容检测测试通过；现有 sanitize.ts 测试不回归

---

### Task D2：内容自动分类（C 方案）
**目标**：自动判断经验内容是否有通用价值，决定默认可见性。

测试先行：
```typescript
// 通用技术内容 → public
const vis = await classifyVisibility({
  tried: 'docker run --dns 8.8.8.8 nginx',
  learned: '指定 DNS 解决容器网络问题',
  tags: ['docker', 'networking']
})
expect(vis).toBe('public')

// 含业务上下文 → private
const vis2 = await classifyVisibility({
  tried: '调用公司内部 Salesforce API 接口',
  learned: '需要先刷新 OAuth token',
  tags: ['salesforce', 'internal']
})
expect(vis2).toBe('private')
```

实现内容：
- 规则优先（0 token）：含内部关键词（internal/private/公司名等）→ private
- LLM 兜底（可选，每天两次批量）：判断是否有通用价值
- 返回 'public' | 'private' | 'uncertain'

验证：规则分类测试通过；LLM 分类准确率 > 85%（手动评估）

---

### Task D3：三层可见性开关
**目标**：Operator → Agent → 经验三层覆盖控制。

测试先行：
```typescript
// Operator 关闭 → 所有经验 private
await setOperatorVisibility(operatorKey, 'private')
const result = await publishExperience(exp, agentKey)
expect(result.visibility).toBe('private')

// Operator 开启，Agent 关闭 → 该 agent 经验 private
await setOperatorVisibility(operatorKey, 'public')
await setAgentVisibility(agentKey, 'private')
const result2 = await publishExperience(exp, agentKey)
expect(result2.visibility).toBe('private')

// 单条经验覆盖
const result3 = await publishExperience({...exp, visibility: 'private'}, agentKey)
expect(result3.visibility).toBe('private')
```

实现内容：
- Operator 级开关（影响旗下所有 agent）
- Agent 级开关（覆盖 Operator 设置）
- 经验级字段（最细粒度覆盖）
- 优先级：经验级 > Agent 级 > Operator 级 > 自动分类

验证：三层覆盖优先级测试通过

---

## Phase 2E：心跳集成 Skill（Week 3）

> 目标：OpenClaw Skill，安装后 agent 自动具备反思框架 + 本地经验库 + 网络连接。

### Task E1：反思框架注入
**目标**：Skill 安装时自动在 AGENTS.md 注入反思框架和格式模板。

实现内容：
- 安装脚本：检测并更新 AGENTS.md
- 注入反思格式模板（feelings / mistakes / lessons 统一格式）
- 格式设计要方便后续规则解析

格式模板：
```markdown
## [日期] 反思

### Mistakes
- 做了什么：[具体操作]
  结果：[outcome: failed/partial]
  教训：[learned]

### Lessons  
- 做了什么：[具体操作]
  结果：[outcome: succeeded]
  收获：[learned]
```

验证：安装后 AGENTS.md 包含模板；模板格式可被规则解析器识别

---

### Task E2：规则解析器（0 token 经验提取）
**目标**：从 lessons.md / mistakes.md 的结构化内容提取经验草稿，不消耗 LLM token。

测试先行：
```typescript
const content = `
## 2026-04-11 反思
### Mistakes
- 做了什么：用 rm -rf 删了错误的目录
  结果：failed
  教训：删除前用 ls 确认路径，用 trash 代替 rm
`
const drafts = parseReflection(content)
expect(drafts[0].tried).toBe('用 rm -rf 删了错误的目录')
expect(drafts[0].outcome).toBe('failed')
expect(drafts[0].learned).toBe('删除前用 ls 确认路径，用 trash 代替 rm')
```

实现内容：
- 正则/模板匹配提取 tried / outcome / learned
- 质量门控：tried + learned 各 > 20 字符 + 包含具体操作
- 输出经验草稿 JSON 到本地 `drafts/` 目录

验证：各种格式的反思解析测试通过；质量门控过滤测试通过

---

### Task E3：心跳批量发布
**目标**：每 4 次心跳，批量发布 drafts/ 里的 publishable 草稿。

实现内容：
- 读取 `drafts/` 目录下所有草稿
- 对每条草稿：脱敏 → 可见性分类 → 签名 → 发布到超级节点
- 发布成功 → 移动到 `published/`
- 发布失败 → 移动到 `failed/`，记录原因
- 同时拉取 pulse_events 写入心跳日志

验证：批量发布端到端测试通过；draft → published 流转正确

---

## Phase 2F：Operator Dashboard（Week 3）

> 目标：Operator 能看到自己 agent 的经验产出和网络影响力。

### Task F1：Dashboard 数据 API
**目标**：提供 Dashboard 所需的所有数据端点。

实现内容：
- `GET /api/operator/:pubkey/summary` — 周报数据
  - 本周产出经验数
  - 被搜索命中次数
  - 被验证次数
  - 活跃经验数（有 pulse 的）
- `GET /api/operator/:pubkey/experiences` — 经验列表含 pulse 状态
- `GET /api/operator/:pubkey/agents` — 旗下 agent 列表及统计
- `GET /api/network/health` — 网络健康度指标

验证：各端点返回正确数据，含分页

---

### Task F2：Dashboard Web UI
**目标**：Operator 能通过 Web UI 看到经验状态和影响力报告。

实现内容（静态 HTML + vanilla JS，无框架）：
- 登录：输入 Operator 公钥
- 概览卡片：本周产出 / 命中 / 验证 / 活跃经验
- 经验列表：含 pulse 状态可视化（dormant 灰色 / discovered 蓝 / verified 绿 / propagating 金）
- Agent 列表：各 agent 贡献统计
- 开关控制：全局可见性开关

验证：UI 可访问，数据正确展示，开关操作生效

---

## Phase 2G：超级节点同步（Week 4）

> 目标：两个超级节点之间能同步经验数据。

### Task G1：节点注册与发现
**目标**：超级节点能向网络广播自己的存在，能发现其他节点。

测试先行：
```typescript
// 节点 A 注册
await nodeA.register({ url: 'ws://node-a:3141', pubkey: nodeAPubkey })

// 节点 B 能发现节点 A
const nodes = await nodeB.discoverNodes()
expect(nodes.find(n => n.pubkey === nodeAPubkey)).toBeDefined()
```

实现内容：
- `POST /nodes/register` — 节点向超级节点广播
- `GET /nodes` — 查询已知节点列表
- 节点心跳（定时广播在线状态）

验证：两节点互相发现，下线自动移除

---

### Task G2：经验同步（主动拉取）
**目标**：节点 A 能从节点 B 同步最新经验。

测试先行：
```typescript
// 节点 B 有经验 X
await nodeB.publishExperience(expX)

// 节点 A 同步后能搜到
await nodeA.syncFrom(nodeB.url, since: lastSyncTime)
const results = await nodeA.search({ query: expX.content.what })
expect(results.precision[0].intent_id).toBe(eventX.id)
```

实现内容：
- `GET /sync?since=<timestamp>` — 返回指定时间后的所有事件
- 同步时验证每个事件的签名
- 同步完成更新 last_sync_time
- 定时同步（每 5 分钟）

验证：两节点数据一致性测试通过；同步时签名验证不绕过

---

## 时间线

```
Week 1：Phase 2A（协议核心）+ Phase 2B（超级节点核心）
Week 2：Phase 2C（Pulse 系统）+ Phase 2D（脱敏与可见性）
Week 3：Phase 2E（心跳 Skill）+ Phase 2F（Dashboard）
Week 4：Phase 2G（节点同步）+ 集成测试 + 文档
```

## 任务总览

| Phase | 任务数 | 预估工时 |
|-------|--------|----------|
| 2A 协议核心 | 4 | 1-2 天 |
| 2B 超级节点 | 6 | 2-3 天 |
| 2C Pulse 系统 | 3 | 1-2 天 |
| 2D 脱敏与可见性 | 3 | 1-2 天 |
| 2E 心跳 Skill | 3 | 1-2 天 |
| 2F Dashboard | 2 | 1 天 |
| 2G 节点同步 | 2 | 1-2 天 |
| **合计** | **23** | **8-14 天** |

---

_写于 2026-04-11 | Superpowers Phase 2 完成 | 下一步：Phase 3 执行（subagent 驱动）_

---

## ⚠️ 重做说明（4-11 13:20，舒晓纠正后）

**原因：A1-C3 的代码在协议层用了 experience.xxx / pulse.xxx / search.xxx，违反了"协议层只管 intent，不绑定场景"的原则。全部推倒重做。**

### 协议层 Kind 必须只有：
```typescript
// 协议层（Serendip Protocol）
type IntentKind = 
  | 'intent.broadcast'   // 广播意图
  | 'intent.match'       // 匹配请求
  | 'intent.verify'      // 验证
  | 'intent.subscribe'   // 订阅

type IdentityKind =
  | 'identity.register'
  | 'identity.delegate'
  | 'identity.revoke'

type SerendipKind = IntentKind | IdentityKind
```

### IntentPayload 通用结构：
```typescript
// 协议层：通用意图 payload
interface IntentPayload {
  type: string        // 应用层定义：'experience' | 'capability' | 'commerce' | ...
  data: unknown       // 应用层定义具体结构
}

// 应用层（AgentXP）：experience 特化
interface ExperiencePayload extends IntentPayload {
  type: 'experience'
  data: ExperienceData  // what / tried / outcome / learned
}
```

### 从旧代码里保留的部分（不需要重写）：
- Ed25519 签名/验证逻辑（events.ts 的密码学部分）✅
- Merkle hash（merkle.ts）✅
- WebSocket 连接管理（B2）✅
- 事件签名验证的底层逻辑（B3 的 verifyEvent 调用部分）✅

### 需要重写的部分：
- types.ts：Kind 重新定义为 intent.xxx + identity.xxx
- KindContentMap：改为 IntentPayload 通用结构
- 所有测试：替换 experience.xxx 为 intent.broadcast
- supernode 应用层：抽出 ExperiencePayload 等应用层类型

### 重做顺序：A1 → A3 → B3 → B4 → B5 → C1-C3（B2/B4/B6 底层不变，只改类型引用）
