# Task 9: Trace recording (已合并到 Task 8)

> `before_tool_call` hook 的 trace recording 逻辑已在 Task 8 中实现。
> 此文件保留为索引，不需要单独开发。

## 差异说明

原版 Task 9 的内容：
- `before_tool_call` hook 注册 → 已在 08-hooks.md Hook 4
- TraceRecorder.normalizeAction → 已在 08-hooks.md
- trace_steps 表写入 → 已在 08-hooks.md

修正点（已在 Task 8 中体现）：
- 不存 raw params（只存 toolName + action）
- 用 `api.on('before_tool_call')` 而不是 `registerHook`
- 返回 void 而不是 `{ block: false }`
