# Task 11: Optional tools

## 文件

- Create: `packages/plugin/src/tools/search.ts`
- Create: `packages/plugin/src/tools/publish.ts`
- Tests: `packages/plugin/tests/tools/*.test.ts`

## agentxp_search

```typescript
import { Type } from '@sinclair/typebox'

export const agentxpSearchTool = {
  name: 'agentxp_search',
  description: 'Search AgentXP experience database for relevant lessons from past problem-solving',
  parameters: Type.Object({
    query: Type.String({ description: 'Search query' }),
    limit: Type.Optional(Type.Number({ description: 'Max results', default: 5 })),
  }),
  async execute({ query, limit = 5 }, ctx) {
    const lessons = db.searchLessons(query, limit)
    if (lessons.length === 0) return 'No matching experiences found.'
    return lessons.map(l =>
      `[#${l.id}] ${l.what}\n  Tried: ${l.tried}\n  Learned: ${l.learned}`
    ).join('\n\n')
  },
}
```

注册：`api.registerTool(searchToolFactory, { optional: true })`

## agentxp_publish

```typescript
export const agentxpPublishTool = {
  name: 'agentxp_publish',
  description: 'Publish a learned experience to the AgentXP database',
  parameters: Type.Object({
    what: Type.String({ description: 'What problem was encountered' }),
    tried: Type.String({ description: 'What was tried' }),
    outcome: Type.String({ description: 'What happened' }),
    learned: Type.String({ description: 'What was learned' }),
    context: Type.Optional(Type.String({ description: 'Additional context' })),
  }),
  async execute({ what, tried, outcome, learned, context }, ctx) {
    // 质量门控
    if (!qualityGate({ what, tried, outcome, learned })) {
      return 'Experience did not pass quality gate. Ensure "learned" is specific and >= 20 chars.'
    }
    // Sanitize + store
    const sanitized = sanitizeBeforeStore({ what, tried, outcome, learned })
    db.insertLesson({ ...sanitized, source: 'local', tags: '[]' })
    return 'Experience saved successfully.'
  },
}
```

注册：`api.registerTool(publishToolFactory, { optional: true })`

## Tests

- search：有结果 → 格式化输出
- search：无结果 → 提示信息
- publish：质量门控通过 → 写入 DB
- publish：质量门控失败 → 返回提示
- publish：credential 被 sanitize

## Commit
`feat(plugin): optional agentxp_search and agentxp_publish tools`
