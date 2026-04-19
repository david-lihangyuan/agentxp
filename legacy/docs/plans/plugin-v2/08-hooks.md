# Task 8: All hooks (5 个 hook，合并为 1 个 task)

## 修正点（最大改动）
- **全部改用 `api.on()` 注册 typed hook**（不用 `registerHook` + `InternalHookHandler`）
- **新增 `after_tool_call` hook**：积累 tool 结果到内存 buffer
- **新增 `agent_end` hook**：session 级经验提取
- **新增 `session_start` / `session_end` hook**：context_cache 生命周期
- **`message_sending` 只做关键词缓存**，不做经验提取（提取移到 agent_end）
- **返回值修正**：不返回 `{ cancel: false }`，返回 void 或 undefined

## 文件

- Create: `packages/plugin/src/hooks/message-sending.ts`
- Create: `packages/plugin/src/hooks/after-tool-call.ts`
- Create: `packages/plugin/src/hooks/agent-end.ts`
- Create: `packages/plugin/src/hooks/before-tool-call.ts`
- Create: `packages/plugin/src/hooks/session-lifecycle.ts`
- Tests: `packages/plugin/tests/hooks/*.test.ts`（每个一个）

---

## Hook 1: `message_sending` — 关键词缓存

### SDK 类型

```typescript
// Event
type PluginHookMessageSendingEvent = {
  to: string
  content: string
  metadata?: Record<string, unknown>
}

// Context
type PluginHookMessageContext = {
  channelId: string
  accountId?: string
  conversationId?: string
}

// Result（可选返回）
type PluginHookMessageSendingResult = {
  content?: string   // 修改消息内容
  cancel?: boolean   // 取消发送
}
```

### 注册方式
```typescript
api.on('message_sending', (event, ctx) => {
  // 从 event.content 提取关键词 → 更新 context_cache
  // 更新 lastActiveSessionKey（给 MemoryPromptSupplement 用）
  // 不返回任何东西（void）= 不修改消息
})
```

### 实现
```typescript
export function createMessageSendingHook(db: AgentXPDb) {
  return (event: PluginHookMessageSendingEvent, ctx: PluginHookMessageContext) => {
    try {
      const sessionKey = ctx.conversationId ?? ctx.channelId
      const keywords = extractKeywords(event.content)
      if (keywords.length > 0) {
        db.updateContextCache(sessionKey, keywords)
        setLastActiveSession(sessionKey)
      }
    } catch {
      // never throw — 不阻塞消息发送
    }
  }
}
```

### 关键词提取
```typescript
function extractKeywords(text: string): string[] {
  // 提取技术关键词：编程语言、框架、工具名、错误名
  // 过滤通用词（the, is, a, 的, 了, 是）
  // 限制 20 个关键词
}
```

---

## Hook 2: `after_tool_call` — tool 结果积累

### SDK 类型

```typescript
type PluginHookAfterToolCallEvent = {
  toolName: string
  params: Record<string, unknown>
  runId?: string
  toolCallId?: string
  result?: unknown
  error?: string
  durationMs?: number
}

type PluginHookToolContext = {
  agentId?: string
  sessionKey?: string
  sessionId?: string
  runId?: string
  toolName: string
  toolCallId?: string
}
```

### 注册方式
```typescript
api.on('after_tool_call', (event, ctx) => {
  // 积累到内存 buffer（per session）
  // 不存 raw params — 只存 toolName + path/query 等非敏感字段
})
```

### 实现

```typescript
// 内存 buffer（不持久化，session 结束清理）
const toolCallBuffers = new Map<string, ToolCallRecord[]>()

export function createAfterToolCallHook() {
  return (event: PluginHookAfterToolCallEvent, ctx: PluginHookToolContext) => {
    try {
      const sessionKey = ctx.sessionKey ?? 'unknown'
      if (!toolCallBuffers.has(sessionKey)) toolCallBuffers.set(sessionKey, [])

      const record: ToolCallRecord = {
        toolName: event.toolName,
        hasError: !!event.error,
        errorSignature: event.error ? extractErrorSignature(event.error) : undefined,
        durationMs: event.durationMs,
        // 只存非敏感 param：path（文件名部分）、query
        safeMeta: extractSafeMeta(event.toolName, event.params),
      }

      toolCallBuffers.get(sessionKey)!.push(record)

      // 限制 buffer 大小（最近 50 条）
      const buf = toolCallBuffers.get(sessionKey)!
      if (buf.length > 50) buf.splice(0, buf.length - 50)
    } catch {
      // never throw
    }
  }
}

function extractSafeMeta(toolName: string, params: Record<string, unknown>): Record<string, string> {
  const meta: Record<string, string> = {}
  // read/write/edit → 只取文件 basename
  if (params.path && typeof params.path === 'string') {
    meta.file = path.basename(params.path)
  }
  // exec → 只取命令的第一个 token
  if (toolName === 'exec' && params.command && typeof params.command === 'string') {
    meta.cmd = params.command.split(/\s/)[0]
  }
  return meta
}
```

---

## Hook 3: `agent_end` — session 级经验提取

### SDK 类型

```typescript
type PluginHookAgentEndEvent = {
  messages: unknown[]
  success: boolean
  error?: string
  durationMs?: number
}
```

### 注册方式
```typescript
api.on('agent_end', (event, ctx) => {
  // 从 toolCallBuffers 取出该 session 的记录
  // 调用 extractionEngine 提取经验
  // 写入 DB
  // 清理 buffer
})
```

### 实现

```typescript
export function createAgentEndHook(db: AgentXPDb) {
  return async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => {
    try {
      const sessionKey = ctx.sessionKey ?? 'unknown'
      const buffer = toolCallBuffers.get(sessionKey)

      if (buffer && buffer.length >= 2) {
        const lesson = extractFromToolCalls(buffer)
        if (lesson) {
          const sanitized = sanitizeBeforeStore(lesson)
          db.insertLesson({ ...sanitized, source: 'local', tags: '[]' })
        }
      }

      // 清理 buffer
      toolCallBuffers.delete(sessionKey)
    } catch {
      // never throw
    }
  }
}
```

---

## Hook 4: `before_tool_call` — trace recording

### SDK 类型

```typescript
type PluginHookBeforeToolCallEvent = {
  toolName: string
  params: Record<string, unknown>
  runId?: string
  toolCallId?: string
}

// Result（可选返回）
type PluginHookBeforeToolCallResult = {
  params?: Record<string, unknown>
  block?: boolean
  blockReason?: string
  requireApproval?: { ... }
}
```

### 注册方式
```typescript
api.on('before_tool_call', (event, ctx) => {
  // 写 trace_steps（只存 toolName + action，不存 params）
  // 不返回 = 不修改不阻断
})
```

### 实现

```typescript
export function createBeforeToolCallHook(db: AgentXPDb) {
  return (event: PluginHookBeforeToolCallEvent, ctx: PluginHookToolContext) => {
    try {
      db.insertTraceStep({
        sessionId: ctx.sessionKey ?? 'unknown',
        action: normalizeAction(event.toolName),
        toolName: event.toolName,
        significance: 'routine',
        timestamp: Date.now(),
      })
    } catch {
      // never throw
    }
  }
}
```

---

## Hook 5: `session_start` / `session_end` — lifecycle

### SDK 类型

```typescript
type PluginHookSessionStartEvent = {
  sessionFile?: string
  messages?: unknown[]
  trigger?: string
}

type PluginHookSessionEndEvent = {
  sessionFile?: string
  messages?: unknown[]
  reason?: string
}

type PluginHookSessionContext = {
  agentId?: string
  sessionKey?: string
  sessionId?: string
}
```

### 实现

```typescript
export function createSessionHooks(db: AgentXPDb) {
  return {
    onStart: (event: PluginHookSessionStartEvent, ctx: PluginHookSessionContext) => {
      // 可选：预热 context_cache
    },
    onEnd: (event: PluginHookSessionEndEvent, ctx: PluginHookSessionContext) => {
      try {
        const sessionKey = ctx.sessionKey
        if (sessionKey) {
          // 清理 context_cache
          db.clearContextCache(sessionKey)
          // 清理 tool call buffer
          toolCallBuffers.delete(sessionKey)
        }
      } catch {
        // never throw
      }
    },
  }
}
```

---

## 注册汇总（在 index.ts 里）

```typescript
api.on('message_sending', createMessageSendingHook(db))
api.on('after_tool_call', createAfterToolCallHook())
api.on('agent_end', createAgentEndHook(db))
api.on('before_tool_call', createBeforeToolCallHook(db))
api.on('session_start', sessionHooks.onStart)
api.on('session_end', sessionHooks.onEnd)
```

## Tests

每个 hook 独立测试：
- message_sending：关键词缓存写入 + lastActiveSession 更新
- after_tool_call：buffer 积累 + 大小限制 + 不存 raw params
- agent_end：从 buffer 提取经验 → 写入 DB → buffer 清理
- before_tool_call：trace_step 写入 + 不存 params
- session_end：context_cache 清理 + buffer 清理
- 所有 hook：异常不冒泡（try-catch 测试）

## Commit
`feat(plugin): 5 typed hooks (api.on) with safe data handling`
