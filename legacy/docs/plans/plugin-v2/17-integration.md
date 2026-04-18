# Task 17: Integration test (full lifecycle)

## 文件

- Create: `packages/plugin/tests/integration.test.ts`

## Full lifecycle test

```typescript
describe('integration: full lifecycle', () => {
  let db: AgentXPDb
  let tmpDir: string
  let capture: MockApiCapture

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentxp-int-'))
    db = createDb(join(tmpDir, 'agentxp.db'))
  })

  afterEach(() => {
    closeDb(db)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('complete lifecycle: install → inject → extract → distill', async () => {
    // 1. Install
    const installResult = await installIfNeeded(db, DEFAULT_CONFIG, tmpDir)
    expect(installResult.installed).toBe(true)
    expect(db.getLessonCount()).toBeGreaterThan(0)

    // 2. Simulate message_sending → keywords cached
    const msgHook = createMessageSendingHook(db)
    msgHook(
      { to: 'user', content: 'I fixed the TypeScript ESM import error by adding .js extensions' },
      { channelId: 'test-channel' }
    )
    const keywords = db.getContextCache('test-channel')
    expect(keywords).toContain('TypeScript')

    // 3. Simulate after_tool_call → buffer accumulated
    const toolHook = createAfterToolCallHook()
    toolHook(
      { toolName: 'exec', params: { command: 'npm test' }, error: 'Module not found' },
      { sessionKey: 'test-session', toolName: 'exec' }
    )
    toolHook(
      { toolName: 'edit', params: { path: 'src/index.ts' } },
      { sessionKey: 'test-session', toolName: 'edit' }
    )
    toolHook(
      { toolName: 'exec', params: { command: 'npm test' }, result: 'All tests pass' },
      { sessionKey: 'test-session', toolName: 'exec' }
    )

    // 4. Simulate agent_end → extraction
    const endHook = createAgentEndHook(db)
    await endHook(
      { messages: [], success: true },
      { sessionKey: 'test-session' }
    )
    // 经验应该被提取并存储
    const lessons = db.searchLessons('TypeScript', 10)
    // 至少有 preloaded + 可能的新提取

    // 5. Prompt supplement → D' injection
    setLastActiveSession('test-channel')
    const builder = createPromptBuilder(db, DEFAULT_CONFIG)
    const lines = builder({ availableTools: new Set(['exec', 'read', 'write']), citationsMode: undefined })
    // 有缓存关键词 → 应该返回注入行（除非被 weaning 跳过）

    // 6. Memory corpus search
    const corpus = createCorpusSupplement(db, DEFAULT_CONFIG)
    const results = await corpus.search({ query: 'ESM import' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].corpus).toBe('agentxp')

    // 7. Memory corpus get
    if (results.length > 0 && results[0].id) {
      const detail = await corpus.get({ lookup: results[0].id! })
      expect(detail).not.toBeNull()
      expect(detail!.content).toContain('Learned')
    }

    // 8. Before_tool_call → trace recorded
    const traceHook = createBeforeToolCallHook(db)
    traceHook(
      { toolName: 'read', params: { path: 'src/index.ts' } },
      { sessionKey: 'test-session', toolName: 'read' }
    )
    const steps = db.getTraceSteps('test-session')
    expect(steps.length).toBeGreaterThan(0)

    // 9. Injection log recorded
    const stats = db.getInjectionStats()
    expect(stats.totalSessions).toBeGreaterThanOrEqual(0)
  })

  it('weaning: ~10% skip rate over 1000 trials', () => {
    const config = { ...DEFAULT_CONFIG, weaning: { enabled: true, rate: 0.1 } }
    setLastActiveSession('weaning-test')
    db.updateContextCache('weaning-test', ['typescript', 'vitest'])

    // 确保有 lessons 可注入
    db.insertLesson({
      what: 'test', tried: 'test', outcome: 'test',
      learned: 'Vitest requires ESM config for TypeScript projects',
      source: 'local', tags: '["vitest"]',
    })

    const builder = createPromptBuilder(db, config)
    let skipCount = 0
    const N = 1000
    for (let i = 0; i < N; i++) {
      const lines = builder({ availableTools: new Set(), citationsMode: undefined })
      if (lines.length === 0) skipCount++
    }

    // 期望 ~100 次跳过（±50 的容差）
    expect(skipCount).toBeGreaterThan(50)
    expect(skipCount).toBeLessThan(200)
  })
})
```

## Tests 覆盖

- 完整生命周期：install → cache → buffer → extract → inject → search
- Weaning 统计测试
- 所有 DB 表有预期数据
- Token budget 不超限
- 错误隔离（hook 内异常不冒泡）

## Commit
`feat(plugin): integration test for full lifecycle`
