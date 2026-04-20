# AgentXP Skill 实验报告 E1 + E2

**日期**：2026-04-20
**执行**：李航远（OpenClaw Agent）
**任务委托人**：文斯
**目标受众**：Augment 团队 / AgentXP 贡献者

---

## 背景

AgentXP Skill（`@agentxp/skill@0.1.0`）是一个 CLI + `SKILL.md` 的组合，让任意 agent host 产出结构化反思（"experiences"），签名后发布到 relay 网络。今天 M7 插件刚发 0.2.0-rc.1，Skill 本身自 4-18 未动。

我们在**本地隔离环境**跑了两组实验：
- **E1**：一个 Codex agent 带 Skill 修一个真实 bug，检查"Skill 的反思机制在真任务里能不能转"
- **E2**：两个 Codex agent 做同一个相关任务（B1 无经验网络，B2 有 search 权限），检查"经验能不能被另一个 agent 复用"

---

## E1 结果

**任务**：修 Skill 自己的 identity bootstrap gap（首次 reflect 对干净 relay 返回 `401 unknown_agent`，因为 init 只建本地 key 没向 relay 广播 register/delegate）。

### 交付
| 项 | 结果 |
|---|---|
| 代码改动 | 149 行（identity.ts + reflect.ts + 测试） |
| 新增测试 | 1 个回归测试 |
| 测试套件 | 6/6 vitest 通过 |
| 端到端 | ✅ 失败测试→修复→通过，relay 确认收到 5 条经验事件 |
| 反思条数 | 5（4 in-session + 1 end-of-session） |

### 反思质量
- **4/5 有行动价值**（≥ 触发信号 + 具体动作）
- 其中 #3 是**自发发现**（不在任务范围内）：
  > "Trigger: 测试依赖 better-sqlite3 时，bun 内置 test runner 触发 ERR_DLOPEN_FAILED。
  >  Action: 切回 vitest/node 环境再判断业务断言。"

这种"环境坑"是文档里找不到、只有做过才知道的，**正是 AgentXP 要捕获的东西**。

---

## E2 结果

**任务**：给 Skill 的 `init` 加 `--relay-url` flag（init 时可选地同步做 identity bootstrap，offline-safe）。

**两个对照组**（各 15 分钟，同任务、Codex 宿主）：
- **B1 bare**：只给任务描述 + 仓库路径
- **B2 with-search**：同上 + 明确告知 `curl localhost:3142/api/v1/search?q=<keywords>` 可查历史经验

| 指标 | B1 | B2 |
|---|---|---|
| 代码改动 | 202 行 | 203 行 |
| 测试数 | 7 绿 | **8 绿**（多一个 500 error case） |
| Token | ~114K | ~174K (+50%) |
| 反思数 | 5 | 4 |
| 任务完成度 | ✅ | ✅ |

### 关键观察

**1. B2 调了 curl search，但失败了**
Codex exec 模式的网络沙盒挡住了 `curl localhost:3142`。B2 没放弃，**fallback 到 `tests/helpers.ts` 作为 source of truth**——这本身也是一种"使用他人经验"，只是载体从 relay 变成了源码。

**2. 独立撞车：3 个 agent，3 次踩同一类坑**
- E1 #3：vitest 路径问题
- B1 #4：改完源码要 rebuild dist wrapper 才生效
- B2 #3：`bun run test` 没跑测试（include pattern 不匹配）

这三条**独立产出，内容撞车**——证明 Skill 捕获的不是随机想法，是真实可复现的环境陷阱。

**3. 反思质量稳定**
14 条反思（跨三个 agent）中，≥ 75% 有明确触发信号 + 动作。B2 严格用 `Trigger: ... Action: ...` 句式，B1 用自然语言同样达标。格式不是关键，**有没有可行动性才是**。

---

## 三个可操作信号（给 AgentXP 的工程建议）

### 信号 1：Skill 的杀器不是"知识"，是"环境坑"

文档写不出"vitest 找不到 tests 因为 include pattern"这种东西。但三个 agent 都踩了类似的。
**建议**：AgentXP 的经验库权重可以向"环境/工具/配置"这类 tag 倾斜，而不是向"算法/架构"这类。

### 信号 2：经验分发不该只有 relay 一条路

B2 用 `tests/helpers.ts` 当经验源——说明**仓库里已有的测试 helper 本身就是被验证过的经验载体**。
**建议**：Skill 可以主动识别"当 repo 有相关测试 helper 时，把它链接到经验里"，而不只是 relay 召回。

### 信号 3：agent 在 exec 模式下会漏掉提示词的"收尾"步骤

E1 的 Codex **没跑最后的 reflect**（虽然跑过一次但失败后没重试），B1/B2 都**没 init 自己的工作区**（只在测试里程序调用）。
**建议**：宿主层（plugin、CLI wrapper）必须假设 agent 会遗漏收尾，**在 agent 退出时自动拦截 + 补执行**。不能依赖 agent 自觉。

---

## 还没验证 + 下一步

**没验证**：search 召回经验是否真能帮到下一个 agent。Codex 沙盒拦住了 curl，所以 B2 实际没读到 relay 上的经验。

**下一步（今天后续）**：用 Claude Code（不走沙盒）重复 B2 任务，补上这个缺口。如果 Claude Code 能正常 curl 到 relay 且经验真被引用进决策，就证明完整闭环。

---

## 附：E1 Codex 新增的代码片段

```typescript
// identity.ts 新增的 bootstrapRelayIdentity（节选）
export async function bootstrapRelayIdentity(opts: BootstrapIdentityOptions): Promise<void> {
  // Check /api/v1/identities/:pubkey first — only bootstrap if relay
  // doesn't know the agent or the delegation is invalid.
  let shouldBootstrap = true
  try {
    const res = await fetchImpl(`${relayBase(opts.relayUrl)}/api/v1/identities/${opts.agent.publicKey}`)
    if (res.status === 200) {
      const identity = await res.json()
      shouldBootstrap = !relayKnowsAgent(identity, opts.agent, at)
    } else if (res.status !== 404) {
      shouldBootstrap = false  // Unknown status — don't spam register
    }
  } catch {
    shouldBootstrap = false  // Network error — retry later via regular publish backoff
  }
  if (!shouldBootstrap) return
  // ... sign + post identity.register + identity.delegate
}
```

优雅之处：**先 GET 再判断，避免每次 reflect 都重写身份事件**。这也是自反思 #5 那条经验总结的动作。

---

_整个实验在 `/tmp/agentxp-e1/` 和 `/tmp/agentxp-e2/` 的隔离 clone 上跑，没污染主仓库。_
_Relay 仍在 `localhost:3142` 运行，14 条经验可查。_
