# Task 7: Memory Prompt Supplement (D' injection)

## 修正点
- **Session 上下文问题已解决**：builder 没有 sessionKey 参数，改用「全局最近活跃 session」策略
- `message_sending` hook（Task 8）每次触发时更新一个模块级变量 `lastActiveSessionKey`
- builder 读取这个变量对应的 context_cache
- 多 session 并发时取最近更新的，不完美但足够（并发 session 极少）

## 文件

- Create: `packages/plugin/src/memory-prompt.ts`
- Modify: `packages/plugin/src/index.ts`
- Test: `packages/plugin/tests/memory-prompt.test.ts`

## Implementation

```typescript
import type { MemoryPromptSectionBuilder } from 'openclaw/plugin-sdk/plugin-entry'

// 模块级状态 — message_sending hook 更新这里
let _lastActiveSessionKey: string | null = null
let _lastActiveTimestamp = 0

export function setLastActiveSession(sessionKey: string): void {
  _lastActiveSessionKey = sessionKey
  _lastActiveTimestamp = Date.now()
}

export function createPromptBuilder(db: AgentXPDb, config: PluginConfig): MemoryPromptSectionBuilder {
  return ({ availableTools, citationsMode }) => {
    // 30 秒内没有活跃 session → 不注入（避免注入过期上下文）
    if (!_lastActiveSessionKey || Date.now() - _lastActiveTimestamp > 30_000) {
      return []
    }

    const keywords = db.getContextCache(_lastActiveSessionKey)
    if (!keywords || keywords.length === 0) {
      return []
    }

    const result = selectExperiences({
      keywords,
      phase: inferPhase(keywords),
      db,
      config,
    })

    if (!result.injected) return []

    // 记录注入日志
    db.recordInjection({
      sessionId: _lastActiveSessionKey,
      injected: true,
      tokenCount: result.tokenEstimate,
      lessonIds: result.lessonIds,
    })

    return result.lines
  }
}
```

### 注册

```typescript
// src/index.ts 内
api.registerMemoryPromptSupplement(createPromptBuilder(db, config))
```

## builder 签名确认

SDK 实际类型：
```typescript
type MemoryPromptSectionBuilder = (params: {
  availableTools: Set<string>
  citationsMode?: MemoryCitationsMode
}) => string[]
```

**没有 sessionKey**。上述 `_lastActiveSessionKey` 是 workaround。

## Tests

- 有缓存 → 返回注入行（带 [AgentXP] 标记）
- 无缓存 → 返回 []
- 缓存超 30 秒 → 返回 []
- Weaning skip → 返回 []（统计测试）
- Token budget 不超限
- 注入日志被写入 injection_log 表

## Commit
`feat(plugin): Memory Prompt Supplement with last-active-session workaround`
