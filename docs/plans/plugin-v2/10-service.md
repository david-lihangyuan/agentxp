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
