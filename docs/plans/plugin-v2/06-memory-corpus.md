# Task 6: Memory Corpus Supplement

## 文件

- Create: `packages/plugin/src/memory-corpus.ts`
- Modify: `packages/plugin/src/index.ts`
- Test: `packages/plugin/tests/memory-corpus.test.ts`

## Implementation

```typescript
import type { MemoryCorpusSupplement, MemoryCorpusSearchResult, MemoryCorpusGetResult } from 'openclaw/plugin-sdk/plugin-entry'

export function createCorpusSupplement(db: AgentXPDb, config: PluginConfig): MemoryCorpusSupplement {
  return {
    async search({ query, maxResults, agentSessionKey }) {
      const limit = maxResults ?? 5
      const lessons = db.searchLessons(query, limit)

      return lessons.map((lesson, i): MemoryCorpusSearchResult => ({
        corpus: 'agentxp',
        path: `agentxp://lesson/${lesson.id}`,
        title: lesson.what,
        kind: 'experience',
        score: 1.0 - (i * 0.1),  // FTS5 结果已按相关度排序
        snippet: `Tried: ${lesson.tried}\nLearned: ${lesson.learned}`,
        id: String(lesson.id),
        citation: `[AgentXP #${lesson.id}]`,
        source: lesson.source,
        provenanceLabel: 'AgentXP',
        sourceType: 'plugin',
      }))
    },

    async get({ lookup, fromLine, lineCount, agentSessionKey }) {
      // lookup = "agentxp://lesson/123" or just "123"
      const id = parseInt(lookup.replace(/^agentxp:\/\/lesson\//, ''), 10)
      if (isNaN(id)) return null

      const lesson = db.getLessonById(id)
      if (!lesson) return null

      const content = [
        `## ${lesson.what}`,
        '',
        `**Tried:** ${lesson.tried}`,
        `**Outcome:** ${lesson.outcome}`,
        `**Learned:** ${lesson.learned}`,
        '',
        `Source: ${lesson.source} | Created: ${new Date(lesson.created_at).toISOString()}`,
        lesson.tags ? `Tags: ${JSON.parse(lesson.tags).join(', ')}` : '',
      ].filter(Boolean).join('\n')

      return {
        corpus: 'agentxp',
        path: `agentxp://lesson/${lesson.id}`,
        title: lesson.what,
        kind: 'experience',
        content,
        fromLine: 1,
        lineCount: content.split('\n').length,
        id: String(lesson.id),
        provenanceLabel: 'AgentXP',
        sourceType: 'plugin',
      }
    },
  }
}
```

### 注册

```typescript
// src/index.ts 内
api.registerMemoryCorpusSupplement(createCorpusSupplement(db, config))
```

## 备注

- `search` 有 `agentSessionKey` 参数可用于 session-specific 过滤（目前不需要，留扩展口）
- agent 调用 `memory_search(corpus='all')` 时自动触发此 supplement
- 不需要额外 tool — Memory Corpus 已经集成到 agent 的 memory_search 里

## Tests

- search 返回 MemoryCorpusSearchResult[] 格式正确
- get 返回单条经验的 markdown 格式
- 空查询返回空数组
- lesson.id 查找：存在 → 返回，不存在 → null
- score 递减
- corpus 字段 = 'agentxp'

## Commit
`feat(plugin): Memory Corpus Supplement for memory_search integration`
