# Task 3: Sanitize + context wrapper

## 修正点
- **Sanitize 在写入时执行**：extractionEngine → sanitize → db.insertLesson。不只是发布时。
- **Preloaded 经验也走 sanitize**：install.ts 导入 preloaded-lessons.json 时，每条过 sanitize pipeline。

## 文件

- Create: `packages/plugin/src/sanitize.ts`
- Create: `packages/plugin/src/context-wrapper.ts`
- Test: `packages/plugin/tests/sanitize.test.ts`
- Test: `packages/plugin/tests/context-wrapper.test.ts`

## Implementation

直接 port `packages/skill/src/sanitize.ts` 和 `packages/skill/src/context-wrapper.ts`。

适配点：
- 输入类型从 relay `Experience` 改为 DB `Lesson`（字段名 what/tried/outcome/learned）
- `sanitizeLesson(lesson)` 对所有 4 个字段执行检测，任一命中则 reject
- 新增 `sanitizeBeforeStore(lesson)` — 只 redact 不 reject（用于写入时清理，不丢弃经验）

### sanitize 分两层

| 函数 | 用途 | 行为 |
|---|---|---|
| `sanitizeBeforeStore(lesson)` | 写入 DB 前 | redact credentials/paths/emails，保留经验 |
| `sanitizeBeforePublish(lesson)` | 发布到 relay 前 | inject detection + unicode detection + credential detection，命中则 reject |

## Tests

- 20 injection 模式全部被 `sanitizeBeforePublish` 拦截
- 15 unicode 模式全部被检测
- 11 credential 模式被 `sanitizeBeforeStore` redact（不拦截，只替换）
- context-wrapper：XML 标签正确包裹、HTML entity 转义、嵌套标签防御

## Commit
`feat(plugin): port sanitize + context-wrapper with store-time redaction`
