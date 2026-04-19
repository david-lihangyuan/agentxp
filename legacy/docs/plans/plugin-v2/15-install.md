# Task 15: Install flow + preloaded experiences

## 修正点
- **Preloaded 经验走 sanitize pipeline**：每条 lesson 过 `sanitizeBeforeStore()` 再写入
- **FTS5 运行时检测**：安装时测试 FTS5 可用性，记录到 DB meta

## 文件

- Create: `packages/plugin/src/install.ts`
- Create: `packages/plugin/templates/preloaded-lessons.json`
- Test: `packages/plugin/tests/install.test.ts`

## Install logic

```typescript
export async function installIfNeeded(db: AgentXPDb, config: PluginConfig, stateDir: string) {
  // 幂等：如果 local_lessons 表已有数据，跳过
  if (db.getLessonCount() > 0) return { installed: false }

  // 1. 导入预装经验（每条过 sanitize）
  const preloaded = JSON.parse(
    readFileSync(join(__dirname, '../templates/preloaded-lessons.json'), 'utf8')
  )
  let imported = 0
  for (const lesson of preloaded) {
    const sanitized = sanitizeBeforeStore(lesson)
    db.insertLesson({
      ...sanitized,
      source: 'preloaded',
      tags: JSON.stringify(lesson.tags ?? []),
    })
    imported++
  }

  // 2. 生成 Serendip identity keys（如果不存在）
  const keyPath = join(stateDir, 'identity.json')
  if (!existsSync(keyPath)) {
    const { generateKeyPair } = await import('@serendip/protocol')
    const keys = generateKeyPair()
    writeFileSync(keyPath, JSON.stringify(keys, null, 2))
  }

  return { installed: true, imported }
}
```

## preloaded-lessons.json

精选 10-15 条高质量经验，覆盖常见 AI agent 场景：
- 配置类（vitest ESM、TypeScript strict mode）
- 调试类（内存泄漏排查、异步错误处理）
- 工具类（git rebase 冲突、Docker 网络）
- OpenClaw 相关（plugin 开发、hook 注册）

格式：
```json
[
  {
    "what": "Vitest fails to import ESM TypeScript modules",
    "tried": "Added extensionsToTreatAsEsm and transform config",
    "outcome": "Tests pass with native ESM resolution",
    "learned": "Vitest needs explicit ESM config: set type:module in package.json and use .js extensions in import paths even for .ts files",
    "tags": ["vitest", "esm", "typescript"]
  }
]
```

## Tests

- 首次安装 → 导入 N 条经验 → 返回 installed: true
- 二次运行 → 跳过 → 返回 installed: false
- 导入的经验已被 sanitize（如果原始数据有 credential → 被 redact）
- Identity keys 生成 → 文件存在
- Identity keys 已存在 → 不覆盖

## Commit
`feat(plugin): install flow + sanitized preloaded experiences`
