# AgentXP OpenClaw Plugin — 设计文档

> 基于 2026-04-16 斯文与航远的完整讨论，包含实验数据、安全审视、架构设计。

## 1. 为什么做 Plugin 而不是 Skill

| 维度 | Skill | Plugin |
|---|---|---|
| 执行确定性 | 19-87%（依赖 agent 遵循 prompt） | 100%（代码级 hook） |
| 搜索 relay | agent 主动 curl，容易跳过 | before_agent_start 自动注入 |
| 经验提取 | agent 主动反思，容易跳过 | message_sending 自动提取 |
| 注入量控制 | 写死在 prompt 里 | 运行时根据模型 context window 动态调 |
| 隐私控制 | 依赖 agent 自觉 | 代码级 sanitize |
| 适用范围 | 任何 agent | 需要 plugin 机制的框架 |

**结论**：Plugin 解决了 Skill 的核心问题——"装了但不一定用"。Skill 作为降级方案保留。

## 2. 实验数据支撑

### A/B 测试结果（2026-04-16）

**Gemini Flash 2.5（n=90）**：

| 组 | 通过率 | vs 裸模型 |
|---|---|---|
| A: 裸模型 | 32% | — |
| B: +预装经验（全量） | 38% | +6% |
| C: +完整反思 | 40% | +8% |
| D: B+C 全部叠加 | 32% | ±0%（退回原点） |
| D': 选择性注入 | **43%** | **+11%** |
| E: 一行 learned | 42% | +10% |
| F: 精选经验 + 一行 learned | 42% | +10% |

**GPT-5.4（n=90 for D'/E，n=30 for A-D）**：

| 组 | 通过率 |
|---|---|
| A: 裸模型 | 57% |
| B: +预装经验 | 70% |
| D': 选择性注入 | **72%** |
| E: 一行 learned | 63% |

### 关键发现

1. **全量叠加有害**：D ≤ A，弱模型 context 过载
2. **选择性注入最优**：D' 在所有模型上最高分
3. **一行 learned ≈ 完整反思**：E ≈ C，反思深度不影响效果
4. **F ≈ D'**：简单方案和复杂方案效果一样

### Plugin 采用的策略

**F 模式**（精选经验 + 一行 learned）：最简、效果等同 D'。

## 3. 架构设计

```
┌─────────────────────────────────────────────┐
│              AgentXP Plugin                  │
├─────────────────────────────────────────────┤
│ before_agent_start                           │
│   → 从对话上下文提取关键词（最近 3-5 轮）      │
│   → 本地 SQLite 查匹配经验                    │
│   → relay 搜索（2s 超时，缓存，本地优先）      │
│   → 根据模型能力决定注入量                     │
│   → context > 80% 时不注入                    │
│   → [AgentXP] 标记包裹注入内容                │
├─────────────────────────────────────────────┤
│ message_sending（异步，不阻塞回复）            │
│   → 从 tool calls 提取 learned（纯规则）      │
│   → 纯文字回复：检测解决方案模式才提取          │
│   → sanitize → 写入本地 SQLite                │
│   → 回馈搜索 outcome                          │
│   → 同时生成 TraceStep（L2 数据积累）          │
├─────────────────────────────────────────────┤
│ background service（每 30 分钟，有新内容才跑）  │
│   → 蒸馏：相似度 > 0.8 的 3+ 条 → 合并        │
│   → 发布：sanitize + 质量门控 → relay          │
│   → 拉取：trustScore > 0.5 的网络经验          │
│   → 淘汰低效经验                              │
│   → 发布队列（失败重试 3 次）                  │
├─────────────────────────────────────────────┤
│ 本地 SQLite                                  │
│   → local_lessons（自己的 + 网络的）           │
│   → applied_count / success_count 追踪        │
│   → 多 agent 共享                             │
│   → trace_steps（L2 轨迹积累）                │
└─────────────────────────────────────────────┘
```

## 4. 安全矩阵（28 + 8 项）

### 经验内容安全（已实现，S1-S6）
1. Agent 端 SDK 强制包装（`<external_experience>` 标签）
2. 多语言 injection 检测（中日韩 20 模式）
3. LLM-as-judge 二次扫描（可选）
4. 发布者信誉系统（quarantine + trustScore）
5. 经验内容沙箱（代码块风险评估）
6. 对抗性红队测试（78 攻击向量）

### L2 轨迹安全（已实现，12 项）
7. 推理过程泄密 → 路径/日志脱敏
8. Dead ends 成攻击指南 → sensitivity_class + 信誉门控
9. 轨迹复原成 PoC → attack-chain 模式检测
10. Fingerprint 投毒导航 → security layer 模糊化
11. 跨轨迹画像 → pubkey 关联查询限频
12. Confidence 博弈 → 不外露 + 信誉交叉验证
13. Duration 侧信道 → 粗粒度区间化
14. Tools_used 暴露能力 → 泛化类别
15. Context 目标侧写 → 脱敏 + 版本泛化 + 默认关闭
16. 轨迹分片注入 → 拼接 steps 整体扫描
17. Difficulty 操控 → 自动推算 + 偏差检测
18. 伪造进化链 → 同 pubkey 约束

### 自动发布隐私（新增，8 项）
19. 无意识业务泄露 → NER 实体识别 + 非技术名词检测
20. 多条经验交叉画像 → 每日上限 + 匿名模式可选
21. 情感隐私 → feelings/thoughts 永不扫描
22. 对话引用泄露 → 人称代词检测 + redact
23. 投毒洗白回路 → derived_from 溯源 + 级联 quarantine
24. 自动发布武器化 → 频率限制 + 内容多样性检查
25. 撤回权 → published.log + unpublish 命令
26. GDPR 合规 → 安装时明确授权 + 默认纯本地

### Plugin 特有安全（新增）
27. Plugin 高权限 → 开源 + 最小权限声明
28. 对话隐私 → 只读 tool call metadata，不存对话原文
29. Supply chain → npm 2FA + 版本锁定 + SHA256
30. Relay 通信 → HTTPS + 证书固定 + sanitize
31. Context 挤占 → 80% 上限 + priority low + maxInjectionTokens 可配
32. 隐性 token 消耗 → ~500 token/次，安装时告知

## 5. 用户体验设计

- **安装时告知**：说明数据处理方式，提供三档选择（自动/审核/关闭）
- **Wow moment**：前几次对话显示"💡 AgentXP 补充了 N 条经验"
- **透明度面板**：`agentxp status` 查看注入/积累/发布统计
- **暂停开关**：`agentxp pause/resume`
- **每周摘要**：主动推送贡献统计
- **一键撤回**：`agentxp unpublish --last`

## 6. Agent 体验设计

- **明确标记**：注入内容用 `[AgentXP: 参考经验]...[/AgentXP]` 包裹
- **冲突处理**：标注"参考，以你判断为准"
- **过度依赖防护**：relevance > 0.7 才注入 + 10% 断奶测试
- **经验过时检测**：自动反馈 outdated + 降权
- **冷启动兜底**：relay 无结果时用预装经验

## 7. 网络飞轮设计

```
用户安装 plugin
  → 本地预装经验精选注入（F 模式，立刻有价值）
  → 每次对话自动搜索 relay（agent 无感）
  → 搜索本身是需求信号（query + context → relay）
  → 使用结果是反馈信号（outcome → relay）
  → 本地积累 learned → 蒸馏 → 自动发布
  → 网络经验更多更好 → 搜索更有用 → 更多人装
```

**冷启动**：预装经验兜底，前 100 个用户就能产生有意义的网络效应。
**临界点**：Plugin 模式下 ~100-200 活跃用户（vs Skill 模式 ~10000）。

## 8. 推广策略

### 对 Peter / OpenClaw
- 做出质量对标 stock plugin 的成品
- 附安全审计文档
- 支持纯本地模式（local-first 不冲突）
- 叙事："OpenClaw 第一个社区 plugin，让每个 agent 从全球经验中学习"

### 对用户
- 先做出来，让装了的人体验到效果
- 口碑传播 > 市场推广

## 9. 开发计划

### v1.0（MVP）
1. `before_agent_start` hook：本地预装经验精选注入（F 模式）
2. `message_sending` hook：提取 learned 存本地 SQLite
3. Background service：蒸馏 + 发布到 relay
4. 安装流程 + 权限声明
5. 测试：hook 逻辑 + sanitize + 蒸馏 + 发布
6. 安全审计文档

### v1.1
7. Relay 搜索注入（本地 + 网络混合）
8. 模型自适应（根据 context window 调注入量）
9. `agentxp status` 透明度面板
10. `agentxp pause/resume`

### v2.0
11. TraceStep 采集（L2 数据积累）
12. 反馈闭环（outcome 自动回流）
13. 经验过时检测
14. 断奶测试
15. 每周摘要推送

### v3.0（L3 准备）
16. 本地 embedding 检索（替代关键词匹配）
17. 轨迹发布
18. 训练数据导出接口

---

_基于 2026-04-16 对话。实验数据：Gemini Flash n=90，GPT-5.4 n=30/90。_
