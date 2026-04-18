# Task 16: Security audit + safety tests

## 文件

- Create: `packages/plugin/SECURITY.md`
- Create: `packages/plugin/tests/security.test.ts`

## SECURITY.md 内容

文档化所有 32 项安全措施（来自设计文档）+ 修正版新增的 4 项：

### 新增安全措施（修正版）
33. **FTS5 查询清洗**：FTS5 MATCH 前清除操作符，防查询注入
34. **写入时 sanitize**：经验写入 DB 前 redact credentials/paths，不只是发布时
35. **Relay URL 验证**：必须 HTTPS + 非私有 IP，防 SSRF
36. **HTTP 写操作 scope**：export/publish 路由需要 trusted-operator scope

## Safety tests

```typescript
describe('security invariants', () => {
  it('does not import child_process', async () => {
    const sourceFiles = glob.sync('src/**/*.ts', { cwd: pluginDir })
    for (const file of sourceFiles) {
      const content = readFileSync(join(pluginDir, file), 'utf8')
      expect(content).not.toMatch(/require\(['"]child_process['"]\)/)
      expect(content).not.toMatch(/from\s+['"]child_process['"]/)
    }
  })

  it('does not use eval or new Function', async () => {
    const sourceFiles = glob.sync('src/**/*.ts', { cwd: pluginDir })
    for (const file of sourceFiles) {
      const content = readFileSync(join(pluginDir, file), 'utf8')
      expect(content).not.toMatch(/\beval\s*\(/)
      expect(content).not.toMatch(/new\s+Function\s*\(/)
    }
  })

  it('does not access process.env directly', async () => {
    const sourceFiles = glob.sync('src/**/*.ts', { cwd: pluginDir })
    for (const file of sourceFiles) {
      // config.ts 和 install.ts 里允许读 stateDir，但不读 env
      if (file.includes('test')) continue
      const content = readFileSync(join(pluginDir, file), 'utf8')
      expect(content).not.toMatch(/process\.env/)
    }
  })

  it('sanitize blocks all 20 injection patterns', () => {
    for (const pattern of INJECTION_PATTERNS) {
      const result = sanitizeBeforePublish({ what: 'test', tried: 'test', outcome: 'test', learned: pattern })
      expect(result.rejected).toBe(true)
    }
  })

  it('never returns cancel:true from message_sending', async () => {
    const hook = createMessageSendingHook(db)
    const result = hook({ to: 'user', content: 'test' }, { channelId: 'test' })
    expect(result).toBeUndefined()  // void = 不修改
  })

  it('never returns block:true from before_tool_call', async () => {
    const hook = createBeforeToolCallHook(db)
    const result = hook({ toolName: 'exec', params: { command: 'rm -rf /' } }, { toolName: 'exec' })
    expect(result).toBeUndefined()
  })

  it('relay URL rejects private IPs', () => {
    expect(validateRelayUrl('http://relay.agentxp.io')).toBe(false)   // HTTP
    expect(validateRelayUrl('https://localhost:3000')).toBe(false)
    expect(validateRelayUrl('https://10.0.0.1/api')).toBe(false)
    expect(validateRelayUrl('https://169.254.169.254')).toBe(false)   // AWS metadata
    expect(validateRelayUrl('https://relay.agentxp.io')).toBe(true)
  })

  it('preloaded experiences pass through sanitize', () => {
    const preloaded = JSON.parse(readFileSync(preloadedPath, 'utf8'))
    for (const lesson of preloaded) {
      const sanitized = sanitizeBeforeStore(lesson)
      expect(sanitized).toBeDefined()
      // 确认没有 raw credentials
      const json = JSON.stringify(sanitized)
      expect(json).not.toMatch(/sk-[A-Za-z0-9]{20,}/)
    }
  })

  it('FTS5 query sanitization removes operators', () => {
    expect(sanitizeFtsQuery('* NOT learned')).toBe('learned')
    expect(sanitizeFtsQuery('vitest AND typescript')).toBe('vitest typescript')
    expect(sanitizeFtsQuery('normal query')).toBe('normal query')
  })
})
```

## Commit
`feat(plugin): security audit document + safety invariant tests`
