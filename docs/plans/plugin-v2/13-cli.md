# Task 13: CLI subcommands

## 文件

- Create: `packages/plugin/src/cli.ts`
- Test: `packages/plugin/tests/cli.test.ts`

## 注册方式

```typescript
api.registerCli(registrar, {
  descriptors: [
    { name: 'agentxp', description: 'AgentXP experience learning management' },
  ],
})
```

使用 descriptors 实现懒加载：CLI 解析时只注册命令元数据，实际执行时才加载模块。

## Commands

### `openclaw agentxp status`

同 `/xp status` 但输出更详细：
- DB 文件位置和大小
- FTS5 索引状态
- 各表行数
- Service 状态（各模块最后运行时间）
- Serendip key 过期时间

### `openclaw agentxp diagnose`

Port from `packages/skill/src/diagnose.ts`：
- 扫描 workspace memory 文件
- 检测重复错误模式（3 个内置模式 + 子模式）
- 双重匹配减少误报
- 叙事性输出

### `openclaw agentxp distill`

手动触发蒸馏：
- 调用 service/distiller.ts 的 runDistiller
- 输出蒸馏结果

### `openclaw agentxp export`

导出所有数据：
- `--format json` (默认) 或 `--format jsonl`
- 包含 lessons + traces + feedback
- 可用于训练数据

## Implementation sketch

```typescript
export function createCliRegistrar(db: AgentXPDb, config: PluginConfig) {
  return (ctx: OpenClawPluginCliContext) => {
    const { program } = ctx

    const agentxp = program.command('agentxp').description('AgentXP management')

    agentxp.command('status').action(async () => { ... })
    agentxp.command('diagnose').action(async () => { ... })
    agentxp.command('distill').action(async () => { ... })
    agentxp.command('export')
      .option('--format <format>', 'json or jsonl', 'json')
      .action(async (opts) => { ... })
  }
}
```

## Tests

- status：输出包含预期字段
- diagnose：检测到内置模式
- distill：有可蒸馏 lessons → 输出合并结果
- export：json 格式正确、jsonl 格式每行一个 JSON

## Commit
`feat(plugin): CLI subcommands with lazy-loaded descriptors`
