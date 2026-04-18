# Task 4: D' selective injection engine

## 修正点
- **Relay URL 验证**：query relay 前验证 URL 必须 HTTPS + 非私有 IP（防 SSRF）
- **FTS5 查询走清洗**：调用 db.searchLessons 时已经在 db 层清洗，injection-engine 不需要额外处理

## 文件

- Create: `packages/plugin/src/injection-engine.ts`
- Test: `packages/plugin/tests/injection-engine.test.ts`

## Core Logic

```typescript
export interface InjectionResult {
  injected: boolean
  lines: string[]           // 注入到 prompt 的行
  tokenEstimate: number
  lessonIds: number[]
  skippedByWeaning: boolean
}

export function selectExperiences(params: {
  keywords: string[]
  phase: 'planning' | 'executing' | 'stuck' | 'evaluating'
  db: AgentXPDb
  config: PluginConfig
}): InjectionResult
```

### 步骤

1. **Weaning check**：`Math.random() < config.weaning.rate` → 返回空（10% 断奶）
2. **本地搜索**：`db.searchLessons(keywords.join(' '), 10)` — FTS5 已在 db 层清洗
3. **网络搜索**（如果 `config.mode === 'network'`）：
   - 验证 relay URL：`validateRelayUrl(config.relayUrl)` — 必须 HTTPS + 非私有 IP
   - `fetch(relayUrl + '/api/v1/search', { signal: AbortSignal.timeout(2000) })`
   - 失败静默（fail-open）
4. **合并 + 去重**（本地优先）
5. **Phase weight 调整**：
   - planning: prefer high-level strategy lessons
   - executing: prefer specific how-to lessons
   - stuck: prefer lessons with backtrack/dead_end patterns
   - evaluating: prefer lessons with outcome verification
6. **Relevance 过滤**：score > 0.7
7. **Token budget**：贪心选 top lessons 直到 `config.maxInjectionTokens`
8. **Context wrap**：用 context-wrapper 包裹，加 `[AgentXP]` 标记

### Relay URL 验证

```typescript
function validateRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    // 检查私有 IP
    const host = parsed.hostname
    if (host === 'localhost' || host === '127.0.0.1') return false
    if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) return false
    if (host.startsWith('169.254.')) return false  // link-local / AWS metadata
    return true
  } catch {
    return false
  }
}
```

### Phase inference（port from skill）

```typescript
export function inferPhase(keywords: string[]): 'planning' | 'executing' | 'stuck' | 'evaluating' {
  const text = keywords.join(' ').toLowerCase()
  if (/error|fail|stuck|debug|why|broken/.test(text)) return 'stuck'
  if (/plan|design|architect|think|decide/.test(text)) return 'planning'
  if (/test|verify|check|assert|confirm/.test(text)) return 'evaluating'
  return 'executing'
}
```

## Tests

- 关键词提取 → 正确搜索
- Phase inference：各场景正确分类
- Relevance scoring：低分经验被过滤
- Token budget：不超 maxInjectionTokens
- Weaning：n=1000 统计测试，skip rate ≈ 10%
- Relay timeout：2s 后 fail-open
- Relay URL 验证：private IP / HTTP / localhost 全部拒绝
- 空结果 → 空注入
- [AgentXP] 标记存在

## Commit
`feat(plugin): D' selective injection engine with SSRF protection`
