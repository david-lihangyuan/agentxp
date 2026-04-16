# Task 12: Chat commands (/xp)

## 文件

- Create: `packages/plugin/src/commands.ts`
- Test: `packages/plugin/tests/commands.test.ts`

## Commands

### `/xp` 或 `/xp status`

```typescript
const xpCommand: OpenClawPluginCommandDefinition = {
  name: 'xp',
  description: 'AgentXP experience learning status and controls',
  acceptsArgs: true,
  requireAuth: true,
  async handler(ctx) {
    const args = (ctx.args ?? '').trim()
    const sub = args.split(/\s+/)[0] || 'status'

    switch (sub) {
      case 'status': return handleStatus(ctx)
      case 'pause':  return handlePause(ctx)
      case 'resume': return handleResume(ctx)
      case 'unpublish': return handleUnpublish(ctx)
      default: return { text: `Unknown subcommand: ${sub}. Available: status, pause, resume, unpublish` }
    }
  },
}
```

### Status output

```
📊 AgentXP Status
━━━━━━━━━━━━━━━━
Local lessons: 47 (3 outdated)
Injections: 128 sessions, 96 injected (75%)
Extractions: 23 this week
Published: 12 (network mode)
Token usage: ~500/request
Mode: network | Relay: relay.agentxp.io
```

### Pause/Resume

通过 plugin config 动态控制。设置一个模块级 `_paused` 变量：
- pause → `_paused = true` → MemoryPromptSupplement 返回空 → hooks 跳过处理
- resume → `_paused = false`

### Unpublish

```typescript
async function handleUnpublish(ctx) {
  const lastPublish = db.getLastPublish()
  if (!lastPublish) return { text: 'Nothing published yet.' }
  db.markUnpublished(lastPublish.id)
  // 如果 network mode，调 relay unpublish API
  if (config.mode === 'network') {
    await fetch(config.relayUrl + '/api/v1/unpublish', { ... })
  }
  return { text: `Unpublished lesson #${lastPublish.lessonId} (relay event: ${lastPublish.relayEventId})` }
}
```

## PluginCommandResult 类型

```typescript
type PluginCommandResult = ReplyPayload
// ReplyPayload = { text?: string; ... }
```

## Tests

- `/xp` → status 输出格式正确
- `/xp status` → 同上
- `/xp pause` → _paused = true
- `/xp resume` → _paused = false
- `/xp unpublish` → 最近发布被标记 unpublished
- `/xp unknown` → 错误提示

## Commit
`feat(plugin): /xp chat commands`
