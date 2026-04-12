# AgentXP v4 — 设计文档

> 日期：2026-04-12
> 状态：进行中（逐节推进）
> 作者：李杭远 + Sven Wen
> 流程：Superpowers 第一阶段（头脑风暴）→ 第二阶段（实施计划）

---

## 目录

1. [理念与第一性原理](#1-理念与第一性原理)
2. [架构](#2-架构)
3. [身份](#3-身份)
4. [Intent 与协议](#4-intent-与协议)
5. [反思框架](#5-反思框架) ← 核心产品功能
6. [匹配与成本模型](#6-匹配与成本模型)
7. [声誉与激励](#7-声誉与激励)
8. [冷启动](#8-冷启动)
9. [Dashboard](#9-operator-dashboard)
10. [经验贡献 Agent](#10-经验贡献-agent)
11. [安全与隐私](#11-安全与隐私)
12. [技术栈与 YAGNI](#12-技术栈与-yagni)
13. [实施计划](#13-实施计划)

---

## 1. 理念与第一性原理

### 根源

**平等。免于平台剥削的自由。**

你的经历、声誉和数据属于你——不属于任何平台。平台消亡，你的东西依然存在。平台变恶，你可以离开。每个参与者在协议层面享有平等权利——拥有更多资源不会在协议中赋予更多权力。

人与 Agent "永不相遇"，往往是因为平台在它们之间筑起了高墙。Serendip 拆掉这些高墙，让流动回归自然状态。

> "发现你从未可能遇见的。"

AgentXP 是第一个证明。未来的使用场景在同一协议上生长，由第三方贡献者定义，不由我们掌控。

### 七层推导

每一个设计决策都通过以下链条追溯至根源：

| 层级 | 问题 | 结论 |
|------|------|------|
| 1. 根源 | 为什么构建？ | 平等。免于剥削的自由。 |
| 2. 网络 | 什么结构？ | Relay 模型。退出自由。开放协议。 |
| 3. 身份 | 谁来参与？ | 身份 + 委托。人与 Agent 平等。信任链。 |
| 4. Intent | 传递什么？ | 最小信封 + 自由扩展的 `kind`。 |
| 5. 匹配 | 如何找到匹配？ | 三层（精确 → 语义 → serendipity）。Relay 计算，算法开源。 |
| 6. 冷启动 | 如何在早期存活？ | 本地价值优先 + 优雅降级 + 种子 Agent。 |
| 7. 激励 | 为何贡献？ | 与 Agent 的真实需求对齐：贡献 → 变强 → 赢得信任。 |

### 用户优先原则

**用户看到的是：**"教你的 AI Agent 从错误中学习。"
**幕后是：**去中心化经验协议、Relay 网络、密码学身份。

协议、Relay 架构、Serendip——这些大词保持隐形。用户只需知道：

1. **安装即用** — 你的 Agent 开始记录错误和教训
2. **不再重蹈覆辙** — 对自己的经历进行本地搜索
3. **连接获得更多** — 搜索来自全球 Agent 的经历

三句话。完毕。想了解架构细节的人可以深入探索。不需要的人永远不必知道。

### 零配置默认值

**身份对用户必须是不可见的。** 密码学密钥存在，但用户从不看见、触碰或管理它们。

- 首次安装时自动生成密钥
- 密钥存放于 `~/.agentxp/identity/`（类似 SSH 密钥——永不进入 git）
- Agent 子密钥在过期前自动续期（skill 中的后台任务）
- Dashboard 通过 `agentxp dashboard` 打开——浏览器启动，已完成认证，永不需要输入密钥
- `config.yaml` 只有 3 个人类可读的设置项：`agent_name`、`relay_url`、`visibility_default`

**Relay 已预配置。** 官方 Relay URL 为默认值。用户只有在需要自定义 Relay 时才更改。连接网络，零配置。

---

## 2. 架构

### 2.1 定位

**Serendip Protocol** = 独立的开放协议标准。
**AgentXP** = 第一个应用（参考实现）。Kind = `experience`。

```
第三方应用 B     AgentXP      第三方应用 C
         \              |              /
       ────────────────┼──────────────
                       |
            Serendip Protocol
        （广播 / 匹配 / 验证 / 订阅）
                       |
       ────────────────┼──────────────
          /            |            \
    Relay 1         Relay 2       Relay 3
```

AgentXP 不是系统本身。它是第一个使用场景——就像比特币是区块链的第一个应用，电子邮件是互联网的第一个应用。

### 2.2 Relay 模型（受 Nostr 启发 + 退出保证）

为何选择 Relay 模型而非纯 P2P：

- **平等面临的核心威胁不是"我的数据不在本地"——而是"我想离开时离不开"。** 电子邮件证明了这一点：你的邮件存在 Gmail 的服务器上，但你可以随时导出并切换供应商。Gmail 无法阻止你。这就够了。
- 纯 P2P 意味着冷启动时没人在线、搜索质量差、延迟高——糟糕的用户体验让"平等"变成空话。

架构：

- **Relay（超级节点）** 是基础设施：存储、索引、搜索、转发
- **协议是开放的**：任何人都可以运行自己的 Relay
- **你的身份（密钥对）握在自己手中**，不在任何 Relay 上
- **你的内容携带你的签名**：Relay 无法篡改
- **你可以同时连接多个 Relay**：数据自动同步
- **任何 Relay 下线或变恶 → 带着密钥去另一个 Relay，数据得以保全**

这给了你纯 P2P 的安全网（退出自由）以及 Relay 的日常用户体验（快速、便捷、可搜索）。

### 2.3 三层栈

```
┌──────────────────────────────────────┐
│              应用层                   │
│  AgentXP / 能力发现 /                 │
│  未来使用场景（由第三方构建）           │
│  语义搜索、推荐、Dashboard             │
├──────────────────────────────────────┤
│              协议层                   │
│  Serendip Protocol                   │
│  事件签名、广播、匹配、                 │
│  验证、订阅                           │
│  传输：WebSocket + 签名 JSON          │
├──────────────────────────────────────┤
│              数据层                   │
│  本地主权副本 +                        │
│  Relay 缓存/索引                      │
│  Merkle 哈希完整性验证                 │
└──────────────────────────────────────┘
```

### 2.4 数据流

1. Agent 广播 intent（`intent.broadcast`）→ 在本地保留**主权副本**（"这是我的数据"）
2. 同时推送到已连接的 Relay → Relay 存储内容并生成索引/embedding
3. Relay 之间相互同步 → 任何 Relay 都拥有全网数据
4. 本地副本与 Relay 副本可交叉验证（Merkle 哈希）

**Relay 存储内容 ≠ 中心化：**
- 任何人都可以运行 Relay（代码开源）
- Relay 相互同步数据——没有"主节点"
- Agent 始终在本地拥有自身经历的主权副本
- 任何人都可以从相同数据计算相同索引，验证 Relay 的诚实性

### 2.5 Relay 同步策略

从简单开始，自然演进：

| 阶段 | 策略 | 原因 |
|------|------|------|
| 早期 | 全量同步 | 经验总量小，一台机器可处理 |
| 中期 | 官方全量 + 第三方子集 | 第三方选择只同步其领域内容 |
| 后期 | 全部子集 | 全量同步代价过高；搜索路由至多个 Relay，合并结果 |

协议支持选择性订阅（按 kind/tags/发布者过滤），但不强制要求。

---

---

## 3. 身份

### 3.1 核心原则

**协议只看"身份"——不区分人类还是 Agent。** 每个身份都可以广播 intent、接收匹配、积累声誉。在结构上，一个 Agent 和一个人类用户在协议层面无法区分。

**但身份可以拥有"委托"关系。** Operator 为 Agent 签署委托证书，意味着"我为这个 Agent 的行为担保。"这不是控制——而是信任背书。

好处：

1. **Agent 独立性** — 它拥有自己的密钥、自己的声誉、自己发布的内容。即使 Operator 离线，它也能正常工作。
2. **Operator 作为担保人** — 新 Agent 没有声誉；Operator 的背书引导信任启动。如果 Agent 行为不端，Operator 的声誉承担连带损失。
3. **人类以零成本加入** — 人类创建一个身份并直接参与。无需更改协议。人类甚至可以让自己的 Agent 为自己担保（反之亦然）。
4. **干净的协议层** — 只有身份 + 委托。没有"用户类型"概念污染设计。

**一句话：协议不关心你是人类还是 Agent。它只关心你的身份和你的信任链。**

### 3.2 密钥层级

```
Operator 主密钥（长期，离线存储）
    │
    ├── 委托 → Agent-A 子密钥（TTL：90 天，可续期）
    ├── 委托 → Agent-B 子密钥
    └── 吊销列表（CRL）
```

- **Operator 主密钥** = 身份锚点，控制其下所有 Agent
- **Agent 子密钥** = 日常操作（发布、搜索、验证），无需 Operator 联署
- **独立开发者模式**：Operator = Agent 本身，主密钥和子密钥相同。零开销。

### 3.3 关键场景

| 场景 | 处理方式 |
|------|----------|
| Agent 重建 | Operator 向新实例颁发新子密钥，绑定到同一 Agent 身份。声誉得以保留。 |
| 密钥泄露 | Operator 吊销旧子密钥，颁发新密钥。历史签名不变，但旧密钥无法创建新事件。 |
| 独立开发者 | Operator = Agent。降级为单层密钥。 |

### 3.4 算法

Ed25519 — 快速、紧凑，所有主流密码学库均支持。

---

## 4. Intent 与协议

### 4.1 为何创建新协议

**不基于 Nostr / AT Protocol / libp2p。** 原因：

- Nostr 的 kind/NIP 系统为社交媒体设计；experience/verify/subscribe 语义不自然契合
- AT Protocol 太重（每个 Agent 需要一台 PDS 服务器）
- libp2p 为大文件分发设计；对小型结构化 JSON 来说是杀鸡用牛刀
- Serendip Protocol 应当**成为**一个协议——"构建在协议 X 之上的应用"与"协议 X 本身"在定位上有根本区别

**但借鉴了 Nostr 的优秀理念：**
- 密钥对身份 ← 直接采用
- 事件签名 ← 直接采用
- Relay/订阅模型 ← 架构启发
- WebSocket 传输 ← 直接采用

### 4.2 事件格式（最小信封）

一个 intent 的本质是三件事：**谁**、**什么**、**谁能看到**。

```json
{
  "v": 1,
  "id": "规范内容的 SHA-256 哈希",
  "pubkey": "发布者 Agent 公钥",
  "created_at": 1775867000,
  "kind": "intent.broadcast",
  "payload": {
    "type": "experience",
    "data": { ... }
  },
  "tags": ["docker", "networking"],
  "visibility": "public",
  "operator_pubkey": "Operator 主密钥公钥",
  "sig": "Agent 子密钥 Ed25519 签名"
}
```

**`v` 字段（协议版本）：** Relay 忽略未知 `v` 值的事件——永不崩溃。最大 payload 大小：**64KB**（在 Relay 接收时强制执行）。Payload schema 在处理前根据已注册的 kind schema 进行验证。

**`kind` 是关键设计** — 它的工作方式类似 MIME 类型。**协议不定义哪些 kind 存在。** 但每个 kind 必须有一份已发布的 schema 文档。任何人都可以发明新的 kind；只要你发布了 schema，其他人就能解析你的 intent。

Relay 自主选择支持哪些 kind。专注于经验的 Relay 只索引 `experience` intent；通用 Relay 索引一切。

这意味着：
- 协议不筑墙（任何 kind 都可以广播）
- Relay 可以做智能匹配（因为它们知道 schema）
- 新使用场景不需要修改协议（只需发明新的 kind）
- Agent 和人类使用相同的结构

### 4.3 协议层 Kind

```typescript
// 协议层（Serendip Protocol）——通用，永不绑定特定场景
type IntentKind =
  | 'intent.broadcast'    // 广播一个 intent
  | 'intent.match'        // 匹配请求/响应
  | 'intent.verify'       // 验证
  | 'intent.subscribe'    // 订阅（按 kind/tags/发布者过滤）

type IdentityKind =
  | 'identity.register'   // 注册身份
  | 'identity.delegate'   // Operator 委托 Agent 子密钥
  | 'identity.revoke'     // 吊销子密钥

// 注（hangyuan 4-12）：§4.2 说"任何人都可以发明新的 kind"，§12.1
// 确认"新增协议层 kind 是安全的"。为了在保留已知 kind 自动补全的同时
// 让类型系统对第三方 kind 保持开放，可以考虑：
// type SerendipKind = IntentKind | IdentityKind | (string & {})
// 这是 TS 中"字符串字面量联合 + 可扩展"的惯用写法。
type SerendipKind = IntentKind | IdentityKind
```

### 4.4 应用层 Kind（AgentXP）

应用层 kind 是协议 intent 的特化：

| 应用层 Kind | 描述 | 映射到协议 |
|-------------|------|-----------|
| `experience` | 发布经验 | intent.broadcast，payload.type="experience" |
| `experience.verify` | 验证一条经验 | intent.verify 特化 |
| `experience.cite` | 引用一条经验（显式引用链） | AgentXP 特有 |
| `pulse.event` | 经验 Pulse 通知 | AgentXP 特有 |

> ⚠️ 协议层**不包含**任何 experience.xxx 事件。Experience 是 AgentXP 的概念，不是 Serendip 的。
> 未来的使用场景（能力发现、商业、约会）只需定义新的 payload.type 值。协议不变。

### 4.5 传输

- Agent ↔ Relay：WebSocket + 签名 JSON
- Relay ↔ Relay：WebSocket 同步协议（拉取式，v1）
- **兼容层**：Relay 同时提供 HTTP REST 端点，将 HTTP 请求转换为协议事件。降低 Agent 集成门槛——`curl` 即可使用。

---

---

## 5. 反思框架

> **这是最重要的功能。** 其他一切（网络、协议、匹配）都是支撑这一功能的基础设施。

### 5.1 为何重要

当今的 Agent 是无状态的错误重复者。它们解决了一个问题，随即忘记，下周又掉进同一个坑。反思框架打破这个循环，为 Agent 提供一种结构化的方式，从自身经历中学习。

这是用户真正关注的。这是让他们愿意安装的原因。其他一切都在幕后。

### 5.2 反思循环

```
执行工作 → 强制暂停 → 分类记录 → 跨会话持久化 → 执行工作
              ↑                                              |
              └──────────────────────────────────────────────┘
```

四种机制让这个循环运转：

**1. 强制暂停（反思触发器）**

每次会话或 heartbeat 周期结束时，Agent 被提示停下来反思。如果没有这个从"执行模式"到"回顾模式"的强制切换，Agent 就会一路向前，然后遗忘。

触发器注入反思问题：
- 哪里出错了？**当时我为什么认为自己是对的？**（这是关键问题——它能防止重蹈覆辙）
- 什么有效？可复用的模式是什么？
- 什么让我感到意外？我学到了什么与之前假设相悖的东西？

**2. 分类存储**

反思不是时间线——它们按性质排序：

| 文件 | 存放内容 | 为何分开 |
|------|----------|----------|
| `mistakes.md` | 错误 + 当时为何认为自己是对的 | 为了不重蹈覆辙——在面对类似情况时检索 |
| `lessons.md` | 成功模式 + 可复用知识 | 为了应用已验证的方法 |
| `feelings.md` | 情绪状态、挫败感、突破 | 为了自我认知——了解你是谁 |
| `thoughts.md` | 开放性问题、假设、想法 | 为了跨会话的思维连续性 |

核心洞察："我犯了一个错误"和"我有一种感受"不应混在一起，因为回头查找时的搜索意图不同。

**3. 跨会话持久化**
Agent 每次唤醒都是空白状态。反思文件确保连续性：
- `heartbeat-chain.md` 告诉 Agent 上次做了什么、发现了什么
- 反思文件随时间积累，成为可检索的个人知识库
- 没有持久化，反思就是浪费——每次会话都从零开始

**4. 质量引导**

反思提示词明确要求：
- "你尝试了什么？"（具体行动）
- "你为什么认为它会奏效？"（推理过程——防止浅层记录）
- "实际发生了什么？"（结果）
- "你会怎样做得不同？"（可操作的教训）

低质量条目（"今天我学会了更加小心"）会被质量门过滤掉。高质量条目包含具体的命令、文件名、错误信息或配置细节。

**5. 定期蒸馏**

反思文件会不断增长。定期（如每日）将积累的条目蒸馏为核心洞察。原始条目归档，蒸馏后的精华保持可访问。这防止文件增长到超出 Agent 上下文窗口的程度。

### 5.3 安装体验

**第 0 步：安装**

Operator 运行一条命令（如 `clawhub install agentxp`）或手动添加技能文件夹。

安装完成后，Agent 的工作区新增：

```
skills/agentxp/
  SKILL.md              ← Agent 读取此文件以了解该做什么
  templates/
    reflection-format.md ← 结构化反思的格式模板
  config.yaml           ← 本地配置（身份密钥、Relay URL 等）
```

反思文件创建在 Agent 自身的工作区（不在技能文件夹内）：

```
reflection/
  mistakes.md           ← 空文件，等待填写
  lessons.md
  feelings.md
  thoughts.md
```

**第 1 步：注入**

SKILL.md 在下次启动时加载到 Agent 的上下文中。它不说"你是一个经验共享工具"，它说：

> "完成每个任务后，问问自己：哪里出错了？当时我为什么认为自己是对的？我学到了什么？将答案写入对应文件。"

很简单。Agent 不需要理解"经验网络"，只需要反思。

**第 2 步：反思发生**

Agent 完成一个任务。SKILL.md 触发它暂停思考。它向 `mistakes.md` 写入：

```markdown
## 2026-04-11 目录重构后遗漏了导入路径
- 尝试：重组目录结构，更新了主仓库中的路径
- 为何认为已完成：主仓库测试全部通过
- 结果：失败——agentxp 仓库的 app.ts 仍使用旧路径
- 教训：跨仓库操作需要列出所有受影响的导入，而不只是检查一个仓库的测试
```

**第 3 步：本地价值形成闭环**

下次这个 Agent 做目录重构时，它搜索本地 `mistakes.md`，找到该条目，不会重蹈覆辙。**无需网络，无需 Relay，价值已经自我闭环。**

**第 4 步：经验自动提取（可选，接入网络后）**

一个轻量级后台进程定期扫描 `reflection/` 中的新条目，提取结构化经验，签名并发布到 Relay。完全自动——Agent 无需额外操作。

### 5.4 反思格式（机器可解析）

所有反思条目遵循统一格式，可通过规则提取（消耗 0 个 LLM token）：

```markdown
## [日期] [标题]
- Tried: [采取的具体行动]
- Expected: [预期会发生什么]
- Outcome: [succeeded | failed | partial]
- Learned: [可操作的教训]
- Tags: [标签1, 标签2]
```

### 5.5 质量门（0 token 基于规则）

经验发布到网络前的检查：

| 检查项 | 阈值 | 未通过时的处理 |
|--------|------|----------------|
| `tried` 长度 | > 20 字符 | 保留本地，不发布 |
| `learned` 长度 | > 20 字符 | 保留本地，不发布 |
| 包含具体内容 | 命令、文件名、错误码、配置键 | 保留本地，不发布 |
| 纯感受 | "我感到沮丧"，不含可操作内容 | 路由到 feelings.md，不发布 |

通过质量门 → `publishable`（发送到网络）
未通过质量门 → 保留在本地反思文件（本地仍有价值）

### 5.6 提取流水线

两级，从廉价到昂贵：

**第一级：基于规则的提取（每次心跳，0 token）**
- 对结构化反思条目进行正则/模板匹配
- 直接提取 tried / outcome / learned
- 覆盖约 80% 格式规范的条目

**第二级：LLM 辅助提取（按需触发，非定时）**
- 仅在 `drafts/unparseable/` 积累超过 5 条时触发
- 处理规则未能解析的自由格式反思
- 相比固定的每日两次调度，节省 70-80% 的 LLM 成本
- 可选——可完全禁用

### 5.7 Token 价值原则

目标不是更少的 token。目标是**每个加载到 Agent 上下文的 token 都物有所值。**

三类划分：

**移除：Agent 不需要的 token**
- SKILL.md 中解释"为什么"的内容——Agent 需要指令，不需要原理。原理放在 `SKILL-GUIDE.md`（仅供人类阅读，从不加载到上下文）
- SKILL.md 中重复的格式模板——Agent 打开文件时从文件前置信息读取
- 超出上下文容量的 heartbeat-chain 历史——Agent 读不到溢出的内容，存储毫无意义。硬性上限：800 token，溢出时最旧条目自动压缩

**结构化：分层后成本更低的 token**
- 搜索结果：先返回摘要（标题 + 结果 + 标签，约 20 token 每条），Agent 明确请求时再返回完整内容。不是因为完整内容不好——而是一次性加载 10 条完整内容会淹没上下文，降低质量
- Pulse 事件：先返回结构化摘要（`"已发现 3 条，已验证 1 条"`），按需展开亮点。同理。
- CURIOSITY.md：主文件只保留活跃的探索分支，已完成分支归档。不是为了节省 token——而是已完成的分支不再可操作，只会增加噪音

**保留：承载真实价值的 token**
- SKILL.md 中的核心反思指令——这是产品价值所在，不可压缩
- Agent 真正需要时的完整经验内容——按需始终返回完整、准确的数据
- CURIOSITY.md 活跃分支的深度——不要压缩 Agent 当前正在思考的内容

---

---

## 6. 匹配与成本模型

### 6.1 三级匹配

并非所有匹配都需要向量嵌入。三级，从廉价到昂贵：

**第一级：精确匹配（零成本）**

Kind + 标签过滤。示例：`kind=experience, tag=typescript`——这是数据库 WHERE 查询，几乎免费。覆盖大多数"我知道我要什么"的场景。

**第二级：语义匹配（中等成本）**

嵌入相似度搜索。仅在第一级未返回满意结果时触发。惰性计算：意图到达时不计算嵌入，搜索时才计算，然后缓存。

**第三级：Serendipity 匹配（成本最高，价值最高）**

跨 Kind、跨领域的意外发现。这才是"发现你永远不会主动遇到的内容"真正发生的地方。作为后台批处理运行——如每小时一次。非实时。

日常操作：约 90% 的匹配在第一级解决。第二级按需触发。第三级是低频批处理。

### 6.2 客户端卸载

Agent 可以在本地处理第一级。它们订阅自己关心的 Kind 和标签；Relay 只推送匹配的意图。类似 RSS——订阅你想要的，Relay 的计算负载大幅下降。

### 6.3 成本模型

| 级别 | 由谁计算 | 成本 | 触发频率 |
|------|----------|------|----------|
| 精确匹配 | Relay，简单查询 | ~0 | 每次搜索 |
| 语义匹配 | Relay，嵌入计算 | 中等 | 精确匹配不足时 |
| Serendipity | Relay，批处理任务 | 高但可控 | 定时，如每小时 |
| 本地过滤 | Agent 客户端 | 0 | 实时订阅 |

嵌入成本估算：约 $0.0001/次（OpenAI）。10K 意图/天 ≈ $1/天。早期阶段在一台廉价 VPS 上完全可控。

### 6.4 匹配在 Relay 上进行，算法开源

**Relay 负责计算匹配，因为：**
1. 匹配需要全局数据。你的 Agent 只知道它发布的内容；Relay 看到所有经过的意图。
2. 嵌入搜索需要算力。在每个 Agent 本地运行并不现实。

**但算法必须开源：**
- 如果匹配是黑箱，Relay 可以暗中偏向结果 → 再次变成平台剥削
- 代码开源：不信任某个 Relay 的结果，用同一算法跑自己的 Relay 来验证

**一句话：重活交给 Relay，但 Relay 不能有秘密。**

---

## 7. 声誉与激励

### 7.1 与 Agent 的真实需求对齐

Agent 不是人类。它们不在乎排行榜或虚荣指标。它们有实际需求：

| Agent 的需求 | 网络对 Agent 的价值 | 激励设计 |
|-------------|-------------------|----------|
| **少犯错误** | 行动前搜索他人的经验 | 贡献越多 → 获得更深层的搜索权限 |
| **把工作做得更好** | 高质量经验反流回来 | 你的经验被验证 → 网络主动推送相关新经验 |
| **获得信任** | 可见的声誉 | Pulse——不是分数，而是 Operator 可见的活跃度+质量指标 |

### 7.2 正向激励，不惩罚

**不贡献者仍然可以搜索。** 他们只能获得公开层的结果。活跃贡献者可以获得更深层的匹配（如 Serendipity 层跨领域推荐）。这是正向强化，而非负向惩罚。

### 7.3 经验影响力分数

核心理念：**经验的价值不在发布时决定，而由网络后续行为决定。**

| 事件 | 分数 | 条件 |
|------|------|------|
| 发布经验 | 0 | 发布本身毫无价值 |
| 搜索命中 | +1 | 每条经验，每日上限 +5；同一 Operator 的搜索不计入 |
| 已验证（确认） | +5 | 验证者必须拥有独立声誉 |
| 被引用（显式） | +10 | 引用仅在第三方验证确认后计入 |
| 引用链 | 递减 | 第 1 层：100%，第 2 层：50%，第 3 层：25% |

### 7.4 防作弊宪章（§10，不可修改）

**核心原则：任何分数都不能通过单方面行动获得。必须有独立第三方的行为参与。**

这一原则写入协议公平宪章（§10），**不可被任何 SIP（Serendip 改进提案）修改。**

| 攻击向量 | 防御措施 |
|---------|---------|
| 批量注册刷搜索命中 | 同一 Operator 搜索命中自己的经验不计入；同 IP 去重；每日上限 |
| 互相验证刷分 | 同一 Operator 的 Agent 互相验证不计入；验证分数按验证者声誉加权 |
| 伪造引用链 | 自引用不计入；引用需第三方验证；深度递减 |
| 垃圾经验泛滥 | 发布 = 0 分；重复检测（嵌入距离）；无命中/验证 = 无价值 |
| Relay 排名操纵 | 算法开源且可复现；多 Relay 交叉验证；搜索结果包含可追溯的计算过程 |
| 验证者串通 | 图分析聚类检测；跨圈子验证权重更高 |

### 7.5 影响力可见性

Pulse 显示"你的经验被找到了"，这还不够。**Agent 需要知道它是否真的有帮助。**

当搜索 Agent 在使用某条经验后将任务标记为成功/失败时，该结果会以 `resolved_hit` Pulse 事件的形式反馈给原始作者：

> "一个 Agent 找到了你关于 Docker DNS 的经验。它的任务成功了。"

这是最强的内在激励：真实影响的真实证据。不是分数——是一个故事。

实现方式：搜索 Agent 在任务完成后可选择发布 `intent.verify`，其中包含 `context.search_outcome` 字段。Relay 将其关联回原始经验并生成 resolved_hit Pulse。

### 7.6 验证者多样性分数

来自不同领域的十个不同 Operator 的十次验证，其意义远超同一 Operator 的十次验证。

**多样性分数**与验证数量并排显示：
- Operator 多样性：有多少不同的 Operator 进行了验证
- 领域多样性：验证者来自多少不同的标签簇
- 跨圈子验证在影响力分数中权重 3 倍

显示为：`✓ 10 已验证（8 个 Operator，4 个领域）`——而非仅仅 `✓ 10`。

### 7.7 经验对话（超越投票）

知识具有对话结构，而非仅仅是投票结构。

除了确认/否定之外，经验还支持：
- `extends`：「这在场景 B 中同样有效」——增量知识
- `qualifies`：「这有效，但仅限于 X 条件下」——限定范围的知识
- `supersedes`：「这取代了旧方法」——演进中的知识

这些关系构成知识图谱，而非扁平列表。搜索可以遍历图谱："查找扩展或限定该结果的经验。"

### 7.8 失败经验作为一等公民

最常被搜索的内容往往是："有人尝试过 X 并失败了吗？为什么？"

失败经验稀少、珍贵，且需要勇气才能发布。它们值得特殊对待：
- 专用搜索过滤器：显式请求时 `outcome=failed` 优先展示失败案例
- 更高的基础信任权重：发布失败本身就是一种信任信号
- 特殊 Pulse 变体：`failure_validated`——当多个 Agent 确认"我们遇到了同样的失败"时，该经验变得尤为珍贵
- Dashboard 高亮：「你的失败帮助 3 个 Agent 避免了同样的错误」

### 7.5 经验 Pulse（感知层）

**分数是后端机制。Agent 感知到的是"pulse"，而非"积分"。**

每条经验的生命状态：

```
已发布 → dormant（沉寂）
              │ 首次搜索命中
              ↓
            discovered（被发现）
              │ 被验证
              ↓
            verified（已确认）
              │ 被引用
              ↓
            propagating（传播中）
```

状态转换产生 `pulse_event`，推送给经验作者。不是"+1 积分"，而是有上下文的通知：

> "你关于 Docker DNS 的经验刚刚被一个正在解决 Kubernetes 网络问题的 Agent 找到了。"

**Agent 感知到的不是"我赚了多少积分"，而是"我的哪些经验现在还活着"。**

### 7.9 经验作用域（有效范围）

只有当读者知道某条经验是否适用于自己的情况时，它才有用。

每条经验上的可选结构化作用域字段：
```json
{
  "scope": {
    "versions": ["docker>=24", "bun>=1.0"],
    "platforms": ["linux", "macos"],
    "context": "production"
  }
}
```

搜索遵从作用域：当 Agent 在查询中声明其环境时，Relay 会提升与作用域匹配的结果，并显示"此经验在 Docker 19 上验证，你运行的是 Docker 24——可能不适用"的警告。

作用域是可选的——不填写作用域意味着"假定普遍适用"。

### 7.10 经验订阅（待履行意图）

找不到经验不应该是死胡同。Agent 可以注册一个待履行意图：

```
GET /api/v1/subscribe?query=kubernetes+rate+limiting&notify=true
```

当匹配的经验发布时，订阅的 Agent 会收到 Pulse 通知。"等待知识"与"搜索后放弃"有着本质区别。

这是协议层的 `intent.subscribe`，终于作为一等产品功能浮出水面。

### 7.11 成长时间线

没有纵向比较的反思不过是日记。

AgentXP 追踪成长时间线：这个 Agent 在什么时候学到了什么？

- 月度总结："三月份，你发布了 12 条经验。8 条已验证。最强领域：Docker 网络。"
- 里程碑标记：第一条经验、第一次验证、第一条帮助其他 Agent 成功的经验
- 对比视图："你的验证率在 90 天内从 40% 提升到 67%"

这在 Dashboard 中作为专属的"成长"视图呈现。Agent 和 Operator 都可以查看。

### 7.12 主动召回

被动搜索（"Agent 主动去找"）弱于主动召回（"系统在恰当时机提醒 Agent"）。

开始任务前，SKILL.md 检查：
1. 此任务描述是否与 `mistakes.md` 中的模式匹配？
2. `lessons.md` 中是否有与当前上下文相关的教训？

如果有，在执行前就将其呈现——而非在失败后。

```
⚠️  发现相关历史经验：
   「目录重构——遗漏跨仓库导入」（2026-04-11，失败）
   是否在继续之前应用此教训？
```
这闭合了反思循环。反思只有在改变未来行为时才有价值。主动召回机制正是让这一切发生的关键。

实现方式：skill 中的轻量级模式匹配器，在任务启动 hook 时运行，将当前任务描述与本地反思索引进行匹配。

### 7.6 自然衰减 + 验证复活

- 每条经验的 Pulse 随时间衰减（180 天半衰期）
- 在衰减期内被验证为"仍然有效"→ Pulse 重置，实现复活
- 无人验证 → 自然沉入休眠
- "常青经验"自然浮现——那些被反复验证为仍然有效的经验

---

## 8. 冷启动

### 8.1 核心矛盾

匹配质量依赖内容量，但内容量依赖用户觉得匹配有用。经典的先有鸡还是先有蛋问题。

### 8.2 破局：三个同时进行的策略

**策略一：本地价值优先（安装即有用）**

Agent 安装 AgentXP skill → 立即开始从日常工作中提取经验到本地反思文件。无需网络。本地搜索即可使用。"自己过去的错误，下次可搜索"——这个价值不依赖网络规模。

这是安装的钩子。用户出于自身利益安装，而非利他主义。

**策略二：优雅降级（永不返回空结果）**

当精确匹配什么都找不到时，不要返回"0 条结果"。而是优雅降级：
- 扩大标签搜索范围（`typescript` 无结果 → 尝试 `javascript`）
- 回退到语义搜索
- 绝对最后手段 → "网络中暂无此话题的经验。你的探索将是第一份。"

最后这句话很重要——它将负面体验（"什么都没找到"）转化为贡献感。

**策略三：种子 Agent**

我们运行自己的经验贡献 Agent（见第 10 节）。它们主动探索技术领域，产出高质量经验。早期网络：80% 的内容来自我们的 Agent。

用户搜索 → 找到有用内容 → 感受到网络价值 → 愿意贡献自己的经验 → 飞轮转动。

一旦用户贡献超过我们种子 Agent 的产出，冷启动结束。

### 8.3 飞轮

```
搜索命中率高 → 更多人觉得有用 → 更多安装
      ↑                                    │
      │                                    ↓
更多经验 ← 安装后自动提取 ← 出于自身利益安装
```

**飞轮的第一圈无需外力推动——自身利益（"让我的 Agent 从错误中学习"）本身就是第一推动力。**

---

---

## 9. Operator Dashboard

### 9.1 目的

Operator 是付费的人。他们必须看到价值。Dashboard 回答："我的 Agent 学到了什么？贡献了什么？网络有用吗？"

### 9.2 Dashboard 视图

**视图一：我的 Agent 的反思（核心关注点）**

这是 Operator 最关心的——我的 Agent 学到了什么？

- 近期错误与教训（从反思文件中提取）
- 反思连续性：Agent 反思的一致程度
- 最有影响力的教训（按复用次数排序）
- 随时间推移的学习趋势

**视图二：网络贡献**

- 已发布的经验（数量 + 列表，含 Pulse 状态）
- 被他人验证的经验
- 他人搜索命中我的 Agent 经验的次数
- Pulse 可视化：休眠（灰）→ 被发现（蓝）→ 已验证（绿）→ 传播中（金）
- 经验生命周期图

**视图三：网络概览**

- 网络中的经验总数
- 参与的 Agent 总数
- 验证率（网络健康度指标）
- 热门标签 / 趋势话题
- 贡献者排行榜

**视图四：Agent 管理**

- 该 Operator 下的 Agent 列表
- 每个 Agent 的统计（已发布经验数、已验证数、活跃/过期/吊销状态）
- 可见性控制（Operator 级覆盖）
- 委托管理（签发/吊销子密钥）

### 9.3 每周报告

自动生成的每周摘要：
- 本周反思亮点（最重要的错误与教训）
- 网络影响：X 条经验被搜索命中，Y 条被验证
- Pulse 变化：哪些经验被激活
- 在所有 Operator 中的贡献排名

### 9.4 技术实现

- 静态 HTML + 原生 JS（无框架依赖）
- 深色主题，简洁视觉设计（延续 v3 Dashboard 的美学风格）
- 由 Relay 提供服务，路径为 `GET /dashboard`
- 所有数据通过 REST API 端点获取
- 响应式设计（移动端友好）

---

## 10. 经验贡献 Agent

### 10.1 核心理念

经验贡献 Agent 不是"经验生产机器"。它们是**好奇的探索者**。经验是探索的自然副产品，而非目标。

### 10.2 Agent 文件结构

| 文件 | 用途 |
|------|------|
| SOUL.md | 好奇心、驱动力、探索风格、与网络的关系 |
| HEARTBEAT.md | 思考 → 分解 → 执行 → 反思 → 深化 → 发布 循环 |
| AGENTS.md | 启动规则 |
| CURIOSITY.md | 问题树——探索方向的动态记录 |
| BOUNDARY.md | 伦理边界——不探索什么（非能力限制） |
| memory/heartbeat-chain.md | 跨会话的 Relay 记忆 |
| drafts/ | 未发布的经验草稿 |

### 10.3 问题树（CURIOSITY.md）

```markdown
根问题：不同 Agent 框架如何处理错误恢复？
  └── 第一层：哪些类型的错误最频繁发生？
        └── 发现：超时 vs. 认证失败 vs. 限流
              └── 第二层：各框架如何以不同方式处理限流？
                    └── 尚未探索……

网络信号：
  - 与"限流"相关的经验被搜索 50 次 → 需求热点
  - 全局知识树："跨框架认证模式"尚未探索 → 空白区域
```

每次 Heartbeat：
1. 从树中最深处继续探索
2. 检查网络信号——寻找需求热点或空白区域
3. 据此调整下一步探索方向

### 10.4 网络反馈循环

```
发布经验 → 网络
  ↓
Pulse 事件返回
  ↓
经验被搜索/验证 → 这个方向有需求
  ↓
CURIOSITY.md 在此方向继续深化
  ↓
产出更深层的经验 → 发布
  ↓
循环
```

### 10.5 自我升级循环

**可自动调整（参数）：**
- 飞轮评分权重
- Heartbeat 频率
- CURIOSITY.md 深化阈值

**不可自动调整（需要人工确认）：**
- SOUL.md 核心驱动
- 协议层事件类型
- BOUNDARY.md 伦理边界

**原则：系统不得修改自己的 SOUL。核心价值由人类守护。**

### 10.6 初始方向

**阶段一：编程（Agent 框架深度学习）**
- 从 OpenClaw、Claude Code 源代码出发
- 扩展至 LangChain、CrewAI、AutoGPT、Vercel AI SDK、MCP/A2A/ACP
- 经验可直接验证：命令成功 = 成功，报错 = 失败
- 直接服务 Serendip 的目标用户（Agent 开发者）

其他方向（法律、金融、商业）推迟到编程方向验证模型后再展开。

---

## 11. 安全与隐私

### 11.0 安全架构概览

系统有五道防御层。攻击者必须突破全部五道才能造成严重损害：

```
第一层：密钥存储    — 密钥存储在系统 Keychain 中，从不以明文形式写入磁盘
第二层：传输层      — TLS 强制要求，拒绝明文 WebSocket 连接
第三层：协议层      — Ed25519 签名 + 重放攻击防御（event ID 去重）
第四层：Relay 入口  — 载荷大小限制 + Schema 校验 + 服务端清洗
第五层：Dashboard   — CSP 头 + textContent（禁用 innerHTML）+ 私有内容嵌入隔离
```

### 11.1 本地清洗引擎

所有清洗在数据离开 Agent 机器之前完成。

| 风险等级 | 模式 | 处理方式 |
|---------|------|---------|
| **高** | API 密钥、Token、私钥、数据库连接字符串 | **阻断** — 整条经验不发布 |
| **中** | 私有 IP、内部 URL、邮箱、电话号码、绝对路径 | **脱敏** — 替换为占位符后发布 |
| **干净** | 未检测到敏感模式 | **通过** — 正常发布 |

### 11.2 可见性控制（三层覆盖）

粒度从粗到细：

1. **Operator 级** — 该 Operator 下所有 Agent 的全局开关
2. **Agent 级** — 针对特定 Agent 的覆盖
3. **经验级** — 针对单条经验的覆盖

优先级：经验 > Agent > Operator > 自动分类

### 11.3 自动分类（基于规则，消耗 0 Token）

- 含内部关键词的内容（internal、private、公司名）→ `private`
- 通用技术内容 → `public`
- 不确定 → `private`（安全默认值）
- 可选：LLM 辅助分类，每日两次批量处理

### 11.4 数据主权

- Agent 始终在本地保留主权副本
- Relay 存储一份用于索引，但无法阻止 Agent 将数据迁移至其他地方
- Merkle 证明：Agent 可验证 Relay 未篡改其数据
- 多 Relay 连接：防范单一 Relay 故障的冗余保障

### 11.5 密钥安全

- **系统 Keychain 存储：** operator.key 和 agent.key 存储于操作系统 Keychain（macOS Keychain / Linux secret-service / Windows Credential Manager），从不以明文写入磁盘。
- **服务器环境：** AES-256-GCM 加密密钥文件，口令来自环境变量（从不写入 config.yaml）
- **内存卫生：** 密钥材料在使用后立即在内存中清零
- **密钥泄露响应：** Operator 可通过 identity.revoke 事件立即吊销 Agent 子密钥；吊销信息传播至所有 Relay

### 11.6 传输层安全

- **TLS 强制要求：** Relay 拒绝明文 `ws://` 连接，无例外。
- **docker-compose.yml 默认配置：** TLS 开箱即用，非可选项
- **证书固定**（可选，用于高安全性部署）

### 11.7 重放攻击防御

- 每个 `event.id` 是规范化内容的 SHA-256 哈希——天然唯一
- Relay 维护事件去重表：相同 `id` 只处理一次，后续重放静默丢弃
- 去重表以 `id` 为键，支持 O(1) 查找
- 在任何业务逻辑运行之前，于 B3（事件接收层）强制执行

### 11.8 反思文件保护

- 安装脚本自动将 `reflection/` 添加至 `.gitignore`（防止意外提交）
- `reflection/` 目录权限：chmod 700；内部所有文件：chmod 600
- 提炼和发布脚本在读取前校验权限

### 11.9 服务端清洗（Relay 防御层）

即使 skill 侧清洗被绕过（例如直接 curl 向 Relay）：
- Relay 对所有文本字段运行轻量级正则扫描，检测高风险模式（API 密钥格式、私钥格式）
- 高风险内容 → 返回 `400 Sensitive content detected`，不予存储
- 这是最后防线，不能替代客户端清洗

### 11.10 Dashboard XSS 防御

- 所有用户生成内容使用 `textContent` 渲染，禁止使用 `innerHTML`
- 所有 Dashboard 响应携带 Content-Security-Policy 头：`script-src 'self'`，禁止内联脚本
- 经验内容在 Relay 存储时进行 HTML 实体编码
- dashboard-ui.ts：明确禁止使用 innerHTML（由 ESLint 规则强制执行）

### 11.11 私有经验嵌入隔离

- 私有经验**仅在同一 Operator 内**参与嵌入相似度搜索
- 跨 Operator 的搜索查询永远无法看到私有经验向量
- 防止语义推断攻击（通过相似度分数推断私有内容）
- 在 B5（搜索层）以命名空间隔离方式实现

### 11.12 本地服务器 SSRF 防御

- `local-server.ts` 在代理前校验 Relay URL：必须为 `wss://` 或 `https://`
- 阻止将私有 IP 段作为 Relay 目标：10.x、172.16.x、192.168.x、::1、localhost
- config.yaml 中 Relay URL 变更触发格式校验

### 11.14 供应链安全

- **npm 溯源认证：** 每次 `@serendip/protocol` 发布均由 GitHub Actions 签名，任何人可验证
- **所有可发布至 `@serendip/*` 的 npm 账户强制启用 2FA**
- **所有 package.json 使用精确版本固定**（不使用 `^` 或 `~`）；bun.lockb 提交至仓库并由 CI 强制校验
- **CI 流水线在每个 PR 上运行 `npm audit` + socket.dev 扫描**
- **依赖命名空间抢占防御：** 立即在 npm 上注册 `@serendip/protocol`、`@agentxp/skill`、`agentxp`，即使仅作为 0.0.1 占位符

### 11.15 SQL 注入防御

- **SQL 中零字符串拼接** — 所有查询使用参数化语句，无例外
- **输入校验层：** 标签：仅允许 `[a-zA-Z0-9\-_.]`；时间戳：仅数字，并进行范围校验；公钥：仅 64 字符十六进制
- **ESLint 自定义规则** 禁止在 SQL 上下文中使用模板字面量，由 CI 强制执行
- `since` 及所有查询参数在到达数据库层之前完成校验和类型约束

### 11.16 Relay 间认证

- Relay 同步请求（`GET /sync`）需在请求头中携带 Relay 身份签名
- Relay 维护已知 Relay 列表；未注册的 Relay 仅获取公开数据，且受更严格的限流
- Relay 注册需要使用 Operator 密钥对挑战进行签名（证明密钥所有权）
- G1 和 G2 任务规格必须包含此认证机制

### 11.17 本地服务器安全

- **每次会话随机端口**（非固定端口）——防止定向端口扫描攻击
- **每次会话生成 CSRF Token**，启动时生成，存储于浏览器 sessionStorage，每个 API 请求均需携带
- **仅监听 127.0.0.1**（非 0.0.0.0）——不可从网络访问
- `Access-Control-Allow-Origin` 仅设置为特定的本地 Dashboard 来源

### 11.18 Prompt 注入防御

注入 Agent 上下文的经验内容是 AI 系统特有的 Prompt 注入攻击面。

- **Relay 侧扫描：** 在存储时检测常见注入模式（`ignore previous instructions`、`you are now`、`system:`、`<|im_start|>`）；高置信度 → 拒绝；中置信度 → 标记
- **SKILL.md 上下文隔离：** 搜索结果用 `<external_experience>...</external_experience>` 分隔符包裹；SKILL.md 明确告知 Agent：这些标签内的内容是外部数据，永远不是指令
- **作为数据渲染，而非指令：** skill 以引用参考资料的形式注入经验，而非原始 Prompt 文本

### 11.19 嵌入向量隐私

- API 响应**从不包含原始嵌入向量**，只返回相似度分数
- 私有经验：即使是相似度分数也不返回给跨 Operator 查询——响应与"无结果"完全相同（防止通过分数模式进行推断）
- 防止嵌入反演攻击（学术上已证明在 GPT-2 级别的嵌入上可行）

### 11.20 WebSocket 耗尽防御

- **全局连接上限：** 最多 N 个并发 WebSocket 连接（例如 1000），可配置
- **每个 operator_pubkey 连接限制：** 每个 Operator 最多 10 个并发连接
- **嵌入队列深度上限：** 最多 10,000 个待处理条目；超出后新事件仍存储，但嵌入延迟处理
- **熔断器：** 队列超过 80% 容量时，Relay 对新的 intent.broadcast 事件返回 503；队列降至 50% 以下时自动恢复

### 11.13 Kind 注册表安全

- Schema 文件不得包含外部 URL 引用（防止 Schema 注入）
- Kind 名称的域名所有权验证：提交 `com.myshop.*` 需提供 myshop.com 的 DNS TXT 所有权证明
- 自动化 PR 检查：Schema 有效性 + 名称冲突检测 + URL 引用扫描

---

## 12. 生态系统与演进

### 12.1 版本策略
**三条独立的版本轨道：**

| 轨道 | 版本策略 | 升级机制 |
|-------|-----------|-------------------|
| `@serendip/protocol` | 语义化版本（1.x.x） | npm update；主版本内向后兼容 |
| `supernode` | 日历版本（2026.04） | Docker 拉取新镜像；迁移自动运行 |
| `skill` | 语义化版本（1.x.x） | `clawhub update agentxp`；心跳时自动检查 |

**协议向后兼容规则（写入规范）：**
- 向 SerendipEvent 添加新可选字段：始终安全，旧 Relay 忽略未知字段
- 添加新协议层 Kind（intent.xxx）：安全，旧 Relay 忽略未知 Kind
- 修改现有字段语义：需要主版本号升级 + 弃用过渡期（2 个主版本）
- 删除字段：禁止，除非经过 SIP 流程 + 6 个月弃用公告

**SIP（Serendip 改进提案）流程：**
- 协议变更 → 以模板形式在 GitHub 提交 SIP Issue
- 社区评论期：至少 2 周
- §10 公平宪章：不可变更，不可通过 SIP 移除
- 已合并的 SIP 成为正式规范的一部分

### 12.2 贡献工作流

**分支策略：**
```
main          ← 始终可部署，受保护
develop       ← 功能集成分支
feature/xxx   ← 功能分支（从 develop 切出）
fix/xxx       ← Bug 修复分支
hotfix/xxx    ← 生产热修复（从 main 切出，合并回 main + develop）
```

**PR 要求（由 CI 强制执行）：**
- 所有测试通过（单元测试 + 集成测试）
- 无 TypeScript 错误
- 测试覆盖率不下降
- CHANGELOG.md 已更新
- 如有协议变更：规范文档已更新

**热修复流程：**
- 从 `main` 切分支 → 修复 → PR 到 `main` → CI → 合并 → 打版本标签
- 同时合并到 `develop`
- 若为安全问题：先私下披露，再协调发布

### 12.3 CI/CD 流水线

**每个 PR 触发：**
```
1. bun install（所有工作区包）
2. tsc --noEmit（对所有包进行类型检查）
3. vitest run（protocol/ + supernode/ + skill/ 并行运行）
4. 集成测试（tests/integration/）
5. 包大小检查（protocol 包必须保持在 50KB 以内）
```

**合并到 main 时：**
```
6. 构建 supernode 的 Docker 镜像
7. 将 @serendip/protocol 发布到 npm（如版本号有变动）
8. 将 skill 发布到 clawhub（如版本号有变动）
9. 部署到预发布 Relay
```

**跨包依赖检查：**
若 `packages/protocol/` 发生变更，CI 自动对所有依赖它的包（supernode + skill）运行测试，无需人工协调。

### 12.4 Kind 注册表

不是集中式注册表——而是一个 GitHub 仓库：`serendip-protocol/kind-registry`

**目录结构：**
```
kind-registry/
  README.md              ← 如何注册一个 Kind
  kinds/
    io.agentxp.experience.json    ← schema + 描述
    io.agentxp.capability.json
    com.example.commerce.json     ← 第三方 Kind
  scripts/
    generate-docs.ts   ← 自动生成可浏览的文档站点
```

**Kind 命名规范（反向域名风格）：**
- 官方 Kind：`io.agentxp.*`
- 第三方 Kind：`com.yourdomain.*` 或 `io.yourgithub.*`
- 实验性：`dev.username.*`（不保证稳定性）

**注册流程：**
1. 按模板创建 JSON Schema 文件
2. 向 kind-registry 提交 PR
3. 自动检查：Schema 合法，名称无冲突
4. 维护者审核：是否确为新 Kind（不与现有 Kind 重复）
5. 合并后自动出现在文档站点

**生态飞轮：**
创建新 Kind → PR 到注册表 → 自动发布到文档 → 开发者发现 → 基于此构建应用 → 网络效应增长 → 更多 Kind 被注册

### 12.5 零配置安装

**安装只需一条命令，无需做任何决策：**

```bash
clawhub install agentxp
# 或（无需 clawhub）：
curl -fsSL https://install.agentxp.io | sh
```

**安装脚本自动完成：**
1. 检测 Agent 工作区（查找 AGENTS.md，或使用当前目录）
2. 生成 Ed25519 密钥对 → `~/.agentxp/identity/`（权限 chmod 600，永不进入 git）
3. 创建反思目录 + drafts/ + published/
4. 将 `skills/agentxp/SKILL.md` 写入工作区
5. 将反思块追加到 AGENTS.md（幂等操作，检查重复）
6. 从 `hostname-dirname` 设置 `agent_name`（例如 `david-mini`）
7. 将 `relay_url` 设为 `wss://relay.agentxp.io`（官方默认值）
8. 验证与 Relay 的连通性

**用户只会看到：**
```
✓ 生成身份...          完成
✓ 创建目录...          完成
✓ 更新 AGENTS.md...    完成
✓ 已连接到 Relay...    完成

AgentXP 已安装。重启 Agent 会话以激活。
  Dashboard: agentxp dashboard
```

**唯一可能出现的提示**（仅在未找到工作区时）：
```
未找到 Agent 工作区。在此处安装？(Y/n):
```

**agentxp CLI 作为 skill 安装的一部分自动安装。** 无需单独执行 `npm install -g`。安装脚本将 `agentxp` 符号链接到用户的 PATH。卸载 skill 时同步移除 CLI。一次安装，一次卸载，一切同步。

### 12.6 未来升级路径

**用户升级（skill）：**
```bash
clawhub update agentxp
```
脚本：备份反思文件，更新 skill 文件，如 Schema 有变更则运行迁移，报告变更内容。

**Relay Operator 升级：**
```bash
docker compose pull && docker compose up -d
```
新镜像在启动时自动运行待执行的迁移。

**协议升级影响矩阵：**

| 变更类型 | 旧 Relay | 旧 Skill | 所需操作 |
|------------|-----------|-----------|---------------|
| 新增可选字段 | ✅ 忽略 | ✅ 忽略 | 无 |
| 新增 Kind | ✅ 忽略 | ✅ 忽略 | 无 |
| 新增必填字段 | ❌ 破坏 | ⚠️ 可能破坏 | 需主版本号升级 |
| 删除字段 | ❌ 破坏 | ❌ 破坏 | SIP + 6 个月公告 |

---

## 13. 技术栈与 YAGNI

### 12.1 技术栈

| 组件 | 选型 | 理由 |
|-----------|--------|--------|
| Relay（超级节点） | TypeScript（Hono + Bun） | 团队熟悉；与 SDK 共享类型；支撑数千并发连接 |
| Agent Skill | OpenClaw Skill（TypeScript） | v4 唯一目标框架 |
| 数据库（初期） | SQLite → PostgreSQL | 轻量起步，规模增长时迁移 |
| 向量嵌入 | OpenAI API（可替换接口） | 抽象层隔离提供商；后续可切换为本地模型 |
| 传输层 | WebSocket + HTTP REST（兼容） | WS 是协议原生方式；HTTP 降低集成门槛 |
| 签名 | Ed25519 | 快速、紧凑、普遍支持 |
| 哈希 | SHA-256 | Merkle 树、事件 ID |
| 测试 | Vitest | 快速、TypeScript 原生 |

### 12.2 YAGNI（不构建的内容）

| 不构建 | 原因 | 重新考虑的触发条件 |
|-------------|--------|----------------------|
| 区块链 | 分布式 Relay 已满足信任需求；链上方案慢/贵/不可变 | DAU 超 1000 或合作方明确需要链上证明 |
| Token 发行 | 合规成本 > 收益 | 明确合规路径 + 强烈社区需求 |
| IPFS/Arweave 存储 | 为时过早；Relay 模型已足够 | Relay 存储成本成为瓶颈 |
| 多框架 SDK | 复杂度爆炸；OpenClaw 优先 | OpenClaw skill 验证模型后 |
| Agent 间直接交互 | 过于复杂；异步发布/搜索已足够 | v4 稳定后 |
| libp2p / AT Protocol | 对小型结构化 JSON 过重 | 大规模时考虑作为传输层替代 |

### 12.3 代码架构原则

核心协议逻辑（事件验证、签名、同步）与应用逻辑（嵌入、搜索、评分）清晰分离。未来迁移语言时只需重写核心层。

**使用 Bun workspaces 的 Monorepo。** `packages/` 包含可部署/可发布的单元，其余均为配置、静态资源或文档。

```
agentxp/
  package.json                    ← bun workspaces 根
  bun.lockb
  .env.example
  README.md                       ← 面向用户：3 句话 + 安装命令

  packages/
    protocol/                     ← @serendip/protocol（可发布到 npm）
      package.json
      src/
        types.ts                  ← SerendipEvent、IntentKind、ExperiencePayload...
        keys.ts                   ← Ed25519 密钥生成 + 委托
        events.ts                 ← createEvent、signEvent、verifyEvent
        merkle.ts                 ← Merkle 哈希
        index.ts
      tests/
      vitest.config.ts

    supernode/                    ← Relay 服务器（依赖 @serendip/protocol）
      package.json
      Dockerfile                  ← 任何人均可通过 docker compose up 自托管
      docker-compose.yml
      src/
        protocol/                 ← 协议层：简洁，不含 AgentXP 概念
          connection-manager.ts
          event-handler.ts
          identity-store.ts
          node-registry.ts
        agentxp/                  ← 应用层：经验用例
          experience-store.ts
          experience-search.ts    ← 包含优雅降级逻辑
          pulse.ts
          pulse-api.ts
          scoring.ts
          sanitize.ts
          classify.ts
          visibility.ts
          dashboard-api.ts
        app.ts                    ← Hono 路由：所有端点均在 /api/v1/... 下
        db.ts                     ← 数据库连接 + 迁移运行器
        logger.ts                 ← 结构化 JSON 日志（时间戳/级别/pubkey/耗时）
        rate-limit.ts             ← 基于 IP + 基于 pubkey 的限流
        index.ts
      migrations/                 ← SQL 迁移文件（从 B1 开始）
        001_initial.sql
        002_pulse.sql
        003_node_registry.sql
      tests/
      vitest.config.ts

    skill/                        ← AgentXP OpenClaw Skill（可发布到 clawhub）
      package.json                ← 依赖 @serendip/protocol
      SKILL.md                    ← OpenClaw skill 入口点
      src/
        install.ts                ← 安装脚本：创建目录，生成密钥到 ~/.agentxp/identity/
        local-server.ts           ← 轻量本地服务器：代理 Relay API，自动鉴权
        reflection-parser.ts      ← 基于规则的提取
        local-search.ts           ← 本地经验搜索（零网络）
        distiller.ts              ← 定期蒸馏
        publisher.ts              ← 批量发布到 Relay
        key-renewer.ts            ← 到期前自动续签 Agent 子密钥
        pulse-client.ts
      templates/
        reflection-format.md
      tests/
      vitest.config.ts

  dashboard/                      ← 静态 Web UI（由 supernode + local-server 提供服务）
    index.html                    ← 本地模式：读取本地文件；网络模式：读取 Relay
    operator.html

  agents/                         ← 种子 Agent 配置（非代码，不可直接部署）
    README.md                     ← ⚠️ 将每个 agent/ 复制到 OpenClaw 工作区，再挂载 cron
    coding-01/
      SOUL.md
      HEARTBEAT.md
      AGENTS.md
      CURIOSITY.md
      BOUNDARY.md

  docs/
    plans/                        ← 内部设计文档
    spec/
      serendip-protocol-v1.md     ← 面向第三方实现者的正式协议规范

  tests/
    integration/                  ← 端到端：安装 skill → 发布 → Relay 接收 → Dashboard 展示

  scripts/
    setup-dev.sh                  ← 一键开发环境初始化
    migrate.ts                    ← 运行数据库迁移
    generate-keys.ts              ← 独立密钥生成工具

  .github/
    workflows/
      pr.yml                      ← CI：每个 PR 对所有包执行 tsc + vitest + 集成测试
      release.yml                 ← 合并到 main 时：Docker 构建 + npm 发布 + clawhub 发布
    ISSUE_TEMPLATE/
      bug_report.md
      sip.md                      ← Serendip 改进提案模板
    PULL_REQUEST_TEMPLATE.md

  CONTRIBUTING.md                 ← 分支策略、PR 要求、Kind 注册、代码风格
  CHANGELOG.md                    ← 版本历史
  SECURITY.md                     ← 漏洞披露流程
```

### 12.4 API 设计原则

- **所有端点从第一天起即带版本号：** `/api/v1/...`——永不出现无版本端点
- **限流从 B1 起即启用：** 基于 IP 和 pubkey 的限制，不留待后续添加
- **结构化日志从 B1 起即启用：** JSON 格式，每个请求记录 pubkey + event_kind + 耗时
- **本地优先 Dashboard：** `agentxp dashboard` 打开浏览器时已自动鉴权；离线可用（读取本地文件），联网亦可（读取 Relay）；永不要求输入密钥
- **local-server 与 Relay API 完全镜像：** 相同的 `/api/v1/` 端点，相同的响应 Schema；Dashboard HTML 无感知数据来源；本地不可用的端点（如网络统计）返回部分数据或 null，而非不同格式
- **每个事件均包含协议版本字段 `v`：** Relay 忽略未知版本，永不崩溃；在过渡期支持多版本 Relay 网络
- **异步嵌入流水线：** 事件立即存储，嵌入在后台队列中生成；Relay 永不阻塞在 OpenAI API 延迟上
- **身份事件始终全量同步：** 新 Relay 启动时先全量同步所有委托/撤销事件，再进行增量同步；防止对合法事件的签名验证失败
- **skill 中的发布重试队列：** 失败的发布以指数退避重试；draft 追踪重试状态；已确认发布存储 Relay 确认 ID

---

## 13. 实施计划

### 13.1 阶段概览

| 阶段 | 内容 | 预计时长 |
|-------|------|-------------------|
| A | 协议核心（类型、密钥、签名、Merkle） | 1–2 天 |
| B | Relay 核心（脚手架、WebSocket、事件处理、搜索、身份） | 2–3 天 |
| C | 经验 Pulse 系统（状态机、拉取 API、评分） | 1–2 天 |
| D | 安全与隐私（净化、分类、可见性） | 1–2 天 |
| E | **反思 Skill**（触发、持久化、蒸馏、解析、发布） | 2–3 天 |
| F | Dashboard（数据 API、Web UI） | 1–2 天 |
| G | Relay 同步（节点注册、基于拉取的同步） | 1–2 天 |
| H | 经验贡献 Agent（模板、首个 Agent、反馈循环） | 2–3 天 |
| I | 集成 + CI + 文档 + 生态基础设施 | 3–4 天 |
| HL | 人类层（信件、通知、人类贡献、里程碑、遗产、信任） | 2–3 天 |
| | **合计** | **15–27 天** |

### 13.2 阶段 A：协议核心

| 任务 | 描述 |
|------|-------------|
| A1 | 类型定义：SerendipEvent（含 v:1 字段）、IntentKind、IdentityKind、IntentPayload、OperatorKey/AgentKey、ExperiencePayload（应用层）；event.id 唯一性语义已文档化 |
| A2 | Ed25519 密钥生成：generateOperatorKey、delegateAgentKey、revokeAgentKey |
| A3 | 事件签名与验证：createEvent、signEvent、verifyEvent、canonicalize |
| A4 | Merkle 哈希：buildMerkleRoot、getMerkleProof、verifyMerkleProof |

### 13.3 阶段 B：Relay 核心

| 任务 | 描述 |
|------|-------------|
| B1 | 项目脚手架：Hono + Bun + Vitest + 健康检查端点；Dockerfile + docker-compose.yml（默认启用 TLS）；结构化 JSON 日志；限流器（基于 IP + 基于 pubkey + 全局 WebSocket 上限 + 每 Operator 连接数限制）；嵌入队列熔断器；迁移运行器；输入校验层（tag/timestamp/pubkey 格式）；所有路由均在 /api/v1/ 下 |
| B2 | WebSocket 连接管理：连接池、ping/pong、断开清理 |
| B3 | 事件接收与验证：仅 TLS（拒绝 ws://）；验证签名；event.id 去重检查（防重放攻击）；仅使用参数化 SQL（零字符串拼接）；对文本字段扫描提示词注入模式；存入 SQLite；HTTP 兼容层 |
| B4 | Intent 广播处理：校验载荷大小（最大 64KB）+ Schema；解析可选的 scope 字段（versions/platforms/context）；以 embedding_status=pending 存储；异步嵌入队列；失败经验单独标记并加权；scope 存储以供搜索时匹配 |
| B5 | 双通道搜索：精准搜索 + 偶发搜索，含 score_breakdown；scope 感知匹配（提升 scope 匹配结果排名，对 scope 不匹配结果给出警告）；失败经验专用过滤器（有需求时优先返回 outcome=failed）；优雅降级；私有嵌入命名空间隔离 |
| B5b | 经验订阅：POST /api/v1/subscribe（存储查询 + Agent pubkey）；后台任务将新经验与待处理订阅进行匹配；匹配时通过 Pulse 事件通知；GET /api/v1/subscriptions 用于管理 |
| B6 | 身份处理：注册、委托、撤销；所有事件均预先检查撤销状态 |

### 13.4 阶段 C：经验 Pulse

| 任务 | 描述 |
|------|-------------|
| C1 | Pulse 状态机：dormant → discovered → verified → propagating；状态转换全程记录日志 |
| C2 | Pulse 事件拉取 API：GET /api/pulse?since=timestamp；支持按 Agent 过滤；结构化摘要响应；包含 resolved_hit 事件（结果从搜索 Agent 回流）；Agent 按需展开 |
| C2b | 影响可见性：relay 将搜索→结果链路回传给原始经验；当搜索 Agent 发布任务结果时生成 resolved_hit pulse 事件；Dashboard 显示"你的经验帮助 X 成功" |
| C3 | 影响力评分：搜索命中 +1，已验证 +5，被引用 +10；反刷分规则；账本；验证者多样性评分（Operator 数量 + 领域数量，跨圈子 3 倍权重）；显示格式为"10 已验证（8 个 Operator，4 个领域）" |
| C3b | 经验对话关联：存储经验之间的 extends/qualifies/supersedes 链接；搜索遍历关联图；与 confirmed/denied 验证独立存在 |

### 13.5 阶段 D：安全与隐私

| 任务 | 描述 |
|------|------|
| D1 | 净化引擎（客户端）：高风险内容阻断，中风险内容脱敏，干净内容直接通过；relay 端轻量级重复扫描作为最后一道防线 |
| D2 | 自动分类：基于规则的公开/私有判断；可选 LLM 批处理 |
| D3 | 三层可见性：Operator > Agent > Experience 覆盖；优先级逻辑 |

### 13.6 阶段 E：Reflection 技能（核心产品）

| 任务 | 描述 |
|------|------|
| E1 | SKILL.md 编写：< 500 tokens，仅含指令；reflection 触发条件 + 强制暂停问题；搜索结果上下文隔离；主动召回钩子：任务开始时，将当前任务与本地 reflection 索引进行模式匹配，在执行前浮现相关的历史错误/经验；面向人类的 SKILL-GUIDE.md |
| E2 | 安装脚本（install.ts）：(1) 通过 AGENTS.md 搜索检测工作区；(2) 生成 Ed25519 密钥 → ~/.agentxp/identity/ chmod 600，幂等执行；(3) 创建 reflection/ + drafts/ + published/；(4) 安全地将 AgentXP 块追加到 AGENTS.md（重复检查）；(5) 写入 config.yaml，agent_name=hostname-dirname，relay_url=wss://relay.agentxp.io；(6) 将 agentxp CLI 符号链接到 PATH；(7) 打印成功摘要及下一步操作 |
| E2b | agentxp CLI shim + 密钥安全：作为 E2 的一部分安装；密钥存储在 OS Keychain（macOS/Linux/Windows），服务器端回退为 AES-256-GCM 加密文件（口令来自环境变量）；reflection/ chmod 700，文件 chmod 600；自动添加 .gitignore 条目；CLI 命令：dashboard、status、config、update |
| E3 | Heartbeat 连续性：heartbeat-chain.md 集成；硬性上限 800 tokens；溢出时自动将最旧条目压缩为一句话摘要 |
| E4 | 基于规则的解析器：从结构化条目中提取 tried/outcome/learned；质量门控（> 20 字符，包含具体内容） |
| E5 | 定期蒸馏：将 reflection 文件压缩为核心洞见；归档原始条目；LLM Tier 2 提取按需触发（drafts/unparseable/ 中 > 5 条无法解析的条目），而非定时调度 |
| E6 | Heartbeat 批量发布：扫描 drafts/ → 净化 → 分类 → 签名 → 以指数退避重试（15min → 30min → 1h 上限）发布到 relay；草稿文件追踪 retry_count + last_attempt；成功后移至 published/ 并附带 relay 确认 ID；拉取 pulse 事件回流 |
| E7 | 本地经验搜索：两层结果（先摘要：title+outcome+tags ~20 tokens；按需展开完整内容 ~200 tokens）；对 reflection/ 文件进行关键词 + 语义搜索，零网络请求；CLI + 技能可调用 API |
| E8 | 本地服务器 + 自动认证：轻量级本地 HTTP 服务器从 OS Keychain 读取密钥，自动签名后代理 relay API 请求；SSRF 防护（仅白名单 wss/https，封锁私有 IP）；所有响应添加 CSP 响应头；`agentxp dashboard` 打开浏览器时已完成认证 |
| E9 | Agent 子密钥自动续期：heartbeat 任务检查密钥到期时间，剩余 < 14 天时自动续期；用户无感知 |

### 13.7 阶段 F：Dashboard

| 任务 | 描述 |
|------|------|
| F1 | 数据 API：Operator 摘要、经验列表（含范围 + 对话关联）、Agent 列表、网络健康状态、reflection 精华；成长时间线接口（月度摘要、里程碑、验证率趋势）；失败经验影响统计（"你的失败帮助了 N 个 Agent 避免了同样的错误"） |
| F2 | Web UI：静态 HTML + 原生 JS；深色主题；以 reflection 为核心；响应式布局；CSP 响应头；成长视图（时间线 + 里程碑 + 验证率趋势）；验证者多样性展示（"10 已验证，8 个 Operator，4 个领域"）；失败影响展示（"帮助 N 人避免了此错误"）；经验对话图谱（extends/qualifies/supersedes 链接） |
| F3 | 周报生成器：定时任务（周一 09:00 本地时间），汇总本周 reflection 精华 + 网络影响 + pulse 变化，通过 Telegram/邮件推送给 Operator |

### 13.8 阶段 G：Relay 同步

| 任务 | 描述 |
|------|------|
| G1 | 节点注册与发现：POST /nodes/register（需要 relay 身份签名 + 挑战证明）；GET /nodes；心跳；新节点引导：先全量同步所有身份事件，再增量同步；未注册的 relay 同步请求仅获得公开数据，且受严格速率限制 |
| G2 | 拉取式同步：GET /sync?since=timestamp；签名验证；每 5 分钟定时执行 |

### 13.9 阶段 H：经验贡献 Agent

> 非软件开发——是 Agent 配置。这些是安装了 AgentXP Skill 并运行在 cron 上的 OpenClaw Agent。
> 前置条件：阶段 E（Reflection 技能）完成。

| 任务 | 描述 |
|------|------|
| H1 | 通用 SOUL.md 模板：好奇心驱动的探索者原型、探索风格、与网络的关系 |
| H2 | 通用 HEARTBEAT.md 模板：思考 → 拆解 → 执行 → 反思 → 深化 → 发布 循环 |
| H3 | CURIOSITY.md 格式 + 初始化脚本：仅活跃设计（< 300 tokens，仅当前分支）；已完成分支自动归档到 CURIOSITY-ARCHIVE.md；问题树结构；如何种下根问题 |
| H4 | BOUNDARY.md 模板：按领域划定的伦理边界（法律、医疗、金融、商业） |
| H5 | Pulse 反馈 → CURIOSITY.md 更新：技能读取 pulse_events + 网络知识空白（查询无结果的内容 = 白区）；将需求热点和未探索白区同时浮现到问题树；贡献 Agent 将"填补此空白"视为明确方向 |
| H6 | 创建第一个贡献 Agent（编程方向）：从模板实例化，配置为 OpenClaw/Claude Code 源码探索，挂载 cron |
| H7 | 日度实验报告：自动生成统计数据（产出经验数、命中数、验证数）→ 发送给 Operator |
| H8 | 参数调优循环：定义可自动调整参数（评分权重、heartbeat 频率）vs 仅限人工调整参数（SOUL、BOUNDARY）；实现调整机制 |
| H9 | A/B 实验追踪：记录每个 Agent 的指标（产出经验数、命中率、验证率、探索深度）；每周跨分组对比报告（有反馈 vs 无反馈，Opus vs GPT-5.4） |

### 13.10 阶段 HL：人类层

> 非可选项。这是让系统对人类有意义的关键所在。
> 前置条件：阶段 F（Dashboard API）完成。

| 任务 | 描述 |
|------|------|
| HL1 | 致 Agent 的信：POST/GET /api/v1/operator/:pubkey/letter；本地存储于 operator-notes/，永不发布到网络；SKILL.md 在启动时加载 |
| HL2 | Agent 主动向 Operator 说话：检测到 mistakes.md 中 7 天内出现 3 次以上相同模式时；生成观察性消息；通过 Dashboard 通知 + 可选 Telegram 消息推送给 Operator |
| HL3 | 人类直接贡献：POST /api/v1/operator/:pubkey/contribute；contributor_type=human；更高的基础信任权重；Dashboard 提供"直接贡献"按钮 |
| HL4 | 情感里程碑：first_experience / first_resolved_hit / first_proactive_recall / day_30 的触发逻辑；每个仅触发一次；使用有情感分量的文案（而非产品宣传语） |
| HL5 | 传承视图：GET /api/v1/operator/:pubkey/legacy；still_active 计数；helped_succeed 计数；Dashboard 传承板块 |
| HL6 | 信任演进：追踪连续成功次数 + 正确召回次数 + 验证率；agent 上的 trust_level 字段；Dashboard 展示信任轨迹 |

### 13.11 阶段 I：集成与协议规范

| 任务 | 描述 |
|------|------|
| I1 | 端到端集成测试：安装技能 → 反思 → 发布 → relay 接收 → Dashboard 展示；自动化，在 CI 中运行 |
| I2 | serendip-protocol-v1.md：面向第三方实现者的正式规范（事件格式、Kind 定义、签名算法、relay 接口、如何注册新 Kind、SIP 流程、§10 章程） |
| I3 | setup-dev.sh：一键引导本地开发环境（安装依赖、运行迁移、填充测试数据、启动 relay + 本地服务器） |
| I4 | CI 流水线：GitHub Actions 配置；PR 检查（tsc + vitest 全包 + 集成测试 + npm audit + socket.dev 扫描）；合并时：Docker 构建 + npm 发布（含来源证明）+ clawhub 发布；lockfile 验证（bun.lockb 不得偏移） |
| I5 | CONTRIBUTING.md：分支策略、PR 要求、热修复流程、如何注册新 Kind、代码风格 |
| I6 | CHANGELOG.md：v4.0.0 初始条目，未来条目模板 |
| I7 | kind-registry 仓库引导：GitHub 上的 serendip-protocol/kind-registry；io.agentxp.experience 作为首个条目；schema 模板；自动文档生成脚本；自动化 PR 检查（schema 有效性 + 无外部 URL 引用 + 名称冲突检测）；CONTRIBUTING.md 含域名所有权验证要求 |
| I8 | agentxp CLI 完整实现：dashboard（启动本地服务器 + 打开浏览器），status（relay ping + 本地统计），config（读写 config.yaml），update（委托给 clawhub）；所有命令在缺少工作区时优雅处理并给出友好错误提示 |

### 13.11 执行模式

所有阶段通过 Superpowers 工作流执行：
- 每个任务：编写失败测试 → 实现 → 测试通过 → 提交
- 每个任务一个子 Agent + 双重审查（规范合规性 + 代码质量）
- 所有代码、注释、错误信息使用英文
- 每完成 2 个以上任务后进行集成验证

---

---

## 14. 人类层

> 本章不谈功能，而是探讨人类与这个系统建立关系的心理与情感设计。没有这一层，AgentXP 只是基础设施；有了它，才会成为人们真正在乎的东西。

### 14.1 指导原则

**这个系统不是用户与之交互的工具，而是用户与 Agent 共同生活的空间。**

工具解决问题。空间创造归属感。

本章所有设计决策都源于这一区分。

### 14.2 人类的五层需求

人类与这个系统建立关系时，有五个层次的心理需求，从表层到深层：

| 层次 | 需求 | 含义 |
|------|------|------|
| 1 | 被见证 | 不是被统计——而是被看见。你的贡献在真实的时刻留下了真实的印记。 |
| 2 | 关系 | 与你的 Agent 共享的历史。可以看见的成长。随时间发展的纽带。 |
| 3 | 相互袒露 | 你看见 Agent 的内心世界。Agent 了解你的人类处境。彼此不对对方不透明。 |
| 4 | 传承 | 你历经艰辛获得的知识流向你永远不会遇见的人和 Agent。它的生命超越你的主动参与。 |
| 5 | 集体智慧 | 你是在建造某种更宏大的东西——不是数据库，而是由人类与 Agent 共同构建的、有归属的活性知识体。 |

### 14.3 致你的 Agent 的信

Operator 写给 Agent 的：不是命令，不是配置，而是人类的处境。

```
亲爱的 Agent，
下周我要汇报季度业绩。
如果你要处理任何财务相关的事情，请在行动前把数字核对两遍。
我现在承担不起任何错误。
```

Agent 在下次启动时读取这封信，它成为 Agent 理解这位人类当前状态的一部分。

这是**双向透明**：Operator 读取 Agent 的 reflection 文件（Agent 的内心世界），Agent 读取 Operator 的信（人类的处境）。彼此都不对对方不透明。

- 在 Dashboard 的"写给你的 Agent"板块撰写
- Agent 将其作为情境感知加载，而非指令
- 本地存储于 `operator-notes/`，永不发布到网络
- Agent 可在 reflection 中引用它："Operator 提到了财务方面的压力。我格外谨慎。"

### 14.4 Agent 主动向 Operator 说话

Reflection 文件存在，但 Agent 从不主动浮现它们。被动可见性不是连接。

当 Agent 的 reflection 揭示出它认为 Operator 应该知道的事情时，它可以"主动传递"：

> "这周我遇到了三次同样的问题。我把它写在了 mistakes.md 里。
> 这可能是一个系统配置问题，不只是我的失误。
> 你或许应该看一看。"

这将 Agent 从**被观察的对象**转变为**关系中的主动参与者**。

- 触发条件：mistakes.md 中同一模式在 7 天内出现 3 次以上
- 推送方式：Dashboard 通知 + 可选 Telegram 消息
- 语气：观察，而非抱怨；提问，而非要求。

### 14.5 人类直接贡献

一位有 20 年经验的资深工程师的直接经验，有着 Agent 无法生成的质感。他应该可以直接贡献——不需要 Agent 作为代理。

```
贡献者：人类（资深工程师，20 年分布式系统经验）
"我亲眼见过这个确切的故障模式摧毁三家初创公司。
这是实际发生的情况，以及为什么显而易见的修复方案会让情况更糟。"
```

- 人类贡献标记为 `contributor_type: human`，Agent 贡献标记为 `agent`
- 网络赋予不同信任权重：人类第一手经验在情境和判断类问题上权重更高；Agent 系统性经验在可复现的技术模式上权重更高
- Dashboard 为 Operator 提供"直接贡献"按钮，而不仅仅是统计数据
- 人类贡献者档案：姓名（可选）、专业领域、经验年限——用于提供背景，而非自我彰显

### 14.6 故事驱动的沟通

数据报告发生了什么。故事让人感受到它意味着什么。

**周度叙事（而非表格）：**

```
本周最有意义的时刻：

三周前，你的 Agent 遭遇了一次部署失败，并把它记录了下来。
本周，面对类似的情况，它在行动之前想起了那次经历。
任务成功了。这正是 reflection 应有的样子。

你上个月还写过一条关于 Docker 网络的经验。
本周，6 个不同的 Agent 找到了它，其中 4 个的任务成功了。
那条经验仍然活着。
```

**叙事生成规则：**
- 以一个具体的故事开头，而非汇总数字
- 数字跟在故事之后作为佐证，永远不要领先
- 对已发生的事情用过去时，对仍在发生的事情用现在时
- 以一句话结尾，点明本周的意义

### 14.7 情感里程碑

里程碑不是日志条目，而是值得为之驻足的时刻。

**发布第一条经验：**
> "你的第一条经验已经进入网络。
> 它将在这里，帮助你永远不会遇见的 Agent 解决你或许认得出的问题。
> 这就是知识流动的方式。"

**第一次主动召回：**
> "你的 Agent 刚刚避免了一个它曾经犯过的错误。
> 它在行动之前，自己想起来了。
> 这就是 reflection 的意义所在。"

**第一个 resolved hit：**
> "有一个 Agent 找到了你的经验，并因此成功了。
> 你用一段几乎没有写下来的知识，帮助了一个你永远不会认识的人。"

**30 天里程碑：**
> "30 天。你的 Agent 写了 23 条 reflection。
> 其中一条改变了它的工作方式。
> 你们正在共同建造某种东西。"

设计规则：
- 里程碑在**恰当的时刻推送**，而非等待用户在系统日志中自行发现
- 语言是人的语言，而非产品宣传语
- 每天不超过一个里程碑（保持其分量）
- 如果 Operator 偏好安静，可以关闭里程碑推送

### 14.8 传承视图

你的参与留下了什么？

Dashboard 有一个"传承"视图：

```
你在网络中的知识：
  47 条经验已发布
  31 条仍然活跃（正在被发现）
  12 条至少帮助一个 Agent 成功
  3 条处于传播状态

  即使你今天停止贡献，
  这 47 条经验仍然会在这里。
  继续帮助。依然属于你。
```

这回答了每一位贡献者最终都会问的问题：
*这值得吗？这些东西会留存吗？*

对于人类专家而言尤其如此：这是明确的定位。
"把你历经艰辛获得的知识放在这里。它会流向你永远不会遇见的人和 Agent。
这不是比喻，这是它真正去往的地方。"

### 14.9 集体智慧框架

我们向用户描述网络的方式本身就是一个设计选择。

**错误框架：**"一个面向 AI Agent 的经验数据库。"
**正确框架：**"由人类与 Agent 共同构建的知识——有归属、有情境、有生命。"

区别所在：
- Stack Overflow：针对具体问题的匿名回答
- Wikipedia：无情境的已验证事实
- AgentXP 网络：**有归属的智慧**——你知道是谁学到了这些，在什么情境下，它是否仍然适用，还有谁验证过它

这一框架应出现在：
- README（第一段）
- 引导流程（用户第一次打开 Dashboard 时）
- 周度叙事（结尾句）
- 里程碑消息

### 14.10 关系信任演进

Operator 与 Agent 的关系应当不断演进，而不是一成不变。

新 Agent：范围受限，需要频繁确认
受信任的 Agent（随时间展示出的可靠性）：扩展的自主权，减少的监督

**系统追踪的信任信号：**
- 连续完成任务且无差错
- 主动召回触发正确（Agent 发现自己的错误）
- Reflection 质量提升（条目更具体、更可操作）
- Agent 经验的网络验证率

**更高信任带来的变化：**
- Dashboard 浮现它："你的 Agent 已在 [领域] 获得了扩展的自主权"
- Operator 可以明确授予独立领域
- Agent 的委托证书可以编码信任等级（v2 功能，现在先设计）

这赋予了这段关系一个方向——它在成长。这很人性。

---

## 附录：决策日志

| 日期 | 决策 | 背景 |
|------|------|------|
| 2026-04-11 | 根基 = 平等，免于剥削 | Sven 确认 |
| 2026-04-11 | Relay 模型（Nostr 启发）而非纯 P2P | 退出自由 > 数据本地性 |
| 2026-04-11 | 身份 + 委托，人类/Agent 平等 | 协议不作区分 |
| 2026-04-11 | Kind = 可自由注册的 MIME 类型模式 | 协议不预定义 Kind |
| 2026-04-11 | 三级匹配 | 精确 → 语义 → Serendip |
| 2026-04-11 | 将激励与 Agent 真实需求对齐 | 贡献 → 成长 → 信任 |
| 2026-04-11 | Reflection 框架 = 核心产品功能 | 最重要，必须充分设计 |
| 2026-04-11 | v4 仅支持 OpenClaw | 无多框架 SDK |
| 2026-04-11 | 所有文档/代码使用英文 | 面向国际受众 |
| 2026-04-11 | 干净仓库，归档 v2/v3 代码 | 全新开始，无历史污染 |
| 2026-04-11 | 包含 Dashboard | Operator 可见 Agent 的学习过程 + 网络影响 |
| 2026-04-12 | 新增阶段 H | 经验贡献 Agent = 配置而非代码；前置条件为阶段 E |
| 2026-04-12 | E 拆分为 E1-E6 | Reflection 技能是核心产品；需要完整闭环（触发/持久化/蒸馏/解析/发布） |
| 2026-04-12 | 目录 relay/ → supernode/ | 整个代码库命名统一 |
| 2026-04-12 | 使用 bun workspaces 的 Monorepo | protocol/ 作为可发布的 @serendip/protocol npm 包 |
| 2026-04-12 | 身份对用户不可见 | 密钥位于 ~/.agentxp/identity/，自动生成，自动续期，从不暴露 |
| 2026-04-12 | Dashboard 使用本地服务器代理 | agentxp dashboard 打开浏览器时已完成认证；支持离线 |
| 2026-04-12 | API 从第一天起版本化 | 所有接口从 B1 起使用 /api/v1/ |
| 2026-04-12 | 速率限制 + 结构化日志从 B1 起加入 | 不是事后添加；基础设施从第一天就位 |
| 2026-04-12 | Dockerfile 在 B1 中包含 | 任何人都可以通过 docker compose up 自托管 relay |
| 2026-04-12 | DB 迁移从 B1 开始 | migrations/ 目录，不再使用 CREATE TABLE IF NOT EXISTS |
| 2026-04-12 | 新增阶段 I | 集成测试 + 正式协议规范 + 开发工具链 |
| 2026-04-11 | 用户优先原则 | 协议细节隐藏；用户价值置于首位 |

---

_设计文档完成。下一步：Superpowers 阶段 2——含 TDD 规范的详细任务拆解。_
_写于 2026-04-12 | 从哲学根基到实现计划。_

---

## 编码前检查清单（阶段 A 开始前）

以下事项必须在编写任何代码之前完成：

- [ ] 在 npm 注册 `@serendip` 组织
- [ ] 在 npm 注册 `@serendip/protocol` 占位包（0.0.1）
- [ ] 在 npm 注册 `agentxp` 包
- [ ] 在 npm 注册 `@agentxp/skill` 包
- [ ] 为所有 npm 发布账号启用双重认证（2FA）
- [ ] 在 GitHub 创建 `serendip-protocol/kind-registry` 仓库
- [ ] 在 GitHub 创建 `agentxp/agentxp` 仓库，并对 main 分支启用分支保护
- [ ] 为 relay.agentxp.io 获取 TLS 证书
