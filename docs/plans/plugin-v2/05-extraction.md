# Task 5: Experience extraction engine

## 修正点
- **数据源改变**：不再从 `message_sending` 的 content 提取 tool call 数据。数据来源改为：
  - `after_tool_call` hook 积累的 tool 结果（存在内存 buffer 里）
  - `agent_end` hook 触发时做 session 级提取
  - `message_sending` 的 content 只用于文本模式检测
- **写入时 sanitize**：提取后先 `sanitizeBeforeStore()` 再写 DB

## 文件

- Create: `packages/plugin/src/extraction-engine.ts`
- Test: `packages/plugin/tests/extraction-engine.test.ts`

## Core Logic

### 两种提取模式

**模式 A：Tool call 提取（主要）**

从 `after_tool_call` 积累的 buffer 里提取：
```typescript
interface ToolCallRecord {
  toolName: string
  params: { path?: string }  // 只保留非敏感字段
  result?: string             // 截断到 200 chars
  error?: string
  durationMs?: number
}
```

检测解决方案模式：
- tool 成功（无 error）+ 之前有 error 的 tool call → "修复了某个问题"
- 连续 read → edit/write → exec(test pass) → "实现了某个功能"
- exec 从失败到成功 → "调试并修复"

**模式 B：文本提取（辅助）**

从 `message_sending` 的 `content` 文本检测：
- "the issue was..." / "fixed by..." / "solved" / "the solution is..."
- "I learned that..." / "turns out..."
- 中文："原因是..." / "解决了" / "发现..."

### 质量门控（port from publisher.ts）

```typescript
function qualityGate(lesson: Partial<Lesson>): boolean {
  if (!lesson.what || lesson.what.length < 10) return false
  if (!lesson.learned || lesson.learned.length < 20) return false
  // 具体性检测：至少包含一个技术名词、路径、或错误名
  if (!/[A-Z][a-z]+Error|\/[\w/]+\.\w+|\b\w+\.\w+\(\)/.test(lesson.learned)) return false
  return true
}
```

### Pipeline

```
ToolCallBuffer / MessageContent
  → 模式检测（A 或 B）
  → 结构化提取（what/tried/outcome/learned）
  → 质量门控
  → sanitizeBeforeStore()
  → return Lesson | null
```

## Tests

- Tool call 模式：error → fix → success 正确提取
- Text 模式：各种文本模式正确检测
- 质量门控：太短拒绝、无技术词拒绝
- Sanitize：credential 被 redact 后仍然通过
- 空输入 → null
- 混合输入（有 tool call 又有文本）→ 只产生一条经验

## Commit
`feat(plugin): experience extraction engine with dual-mode detection`
