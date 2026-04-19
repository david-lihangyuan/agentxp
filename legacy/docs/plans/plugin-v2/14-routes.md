# Task 14: HTTP routes

## 修正点
- **Handler 是 raw Node.js `(req: IncomingMessage, res: ServerResponse)`**，不是 Express
- **写操作路由加 `gatewayRuntimeScopeSurface: 'trusted-operator'`**
- **Export 路由加速率限制**（handler 内部实现）

## 文件

- Create: `packages/plugin/src/routes.ts`
- Test: `packages/plugin/tests/routes.test.ts`

## Routes

```typescript
import type { IncomingMessage, ServerResponse } from 'http'

export function registerRoutes(api: OpenClawPluginApi, db: AgentXPDb, config: PluginConfig) {

  // GET /plugins/agentxp/status — 读操作
  api.registerHttpRoute({
    path: '/plugins/agentxp/status',
    auth: 'gateway',
    match: 'exact',
    async handler(req: IncomingMessage, res: ServerResponse) {
      const stats = db.getInjectionStats()
      const lessonCount = db.getLessonCount()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ lessons: lessonCount, ...stats }))
    },
  })

  // GET /plugins/agentxp/lessons?offset=0&limit=20 — 读操作
  api.registerHttpRoute({
    path: '/plugins/agentxp/lessons',
    auth: 'gateway',
    match: 'exact',
    async handler(req, res) {
      const url = new URL(req.url ?? '', 'http://localhost')
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100)
      const lessons = db.listLessons(offset, limit)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ lessons, offset, limit }))
    },
  })

  // GET /plugins/agentxp/traces — 读操作
  api.registerHttpRoute({
    path: '/plugins/agentxp/traces',
    auth: 'gateway',
    match: 'exact',
    async handler(req, res) {
      const sessions = db.listTraceSessions(20)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions }))
    },
  })

  // GET /plugins/agentxp/export — 数据导出（加速率限制）
  api.registerHttpRoute({
    path: '/plugins/agentxp/export',
    auth: 'gateway',
    gatewayRuntimeScopeSurface: 'trusted-operator',
    match: 'exact',
    async handler(req, res) {
      // 简易速率限制：每分钟最多 3 次
      if (!checkRateLimit('export', 3, 60_000)) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }))
        return
      }
      const lessons = db.listAllLessons()
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': 'attachment; filename="agentxp-export.jsonl"',
      })
      for (const lesson of lessons) {
        res.write(JSON.stringify(lesson) + '\n')
      }
      res.end()
    },
  })

  // POST /plugins/agentxp/publish — 写操作（trusted-operator）
  api.registerHttpRoute({
    path: '/plugins/agentxp/publish',
    auth: 'gateway',
    gatewayRuntimeScopeSurface: 'trusted-operator',
    match: 'exact',
    async handler(req, res) {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      // 触发批量发布
      const result = await batchPublish(db, config)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    },
  })
}
```

## 速率限制

```typescript
const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const timestamps = rateLimitMap.get(key) ?? []
  const recent = timestamps.filter(t => now - t < windowMs)
  if (recent.length >= maxRequests) return false
  recent.push(now)
  rateLimitMap.set(key, recent)
  return true
}
```

## Tests

- GET /status → 200 + JSON 格式
- GET /lessons → 分页正确
- GET /traces → session 列表
- GET /export → JSONL 格式 + rate limit（第 4 次 → 429）
- POST /publish → 触发发布
- export/publish 需要 trusted-operator scope

## Commit
`feat(plugin): HTTP routes with scope-based auth + rate limiting`
