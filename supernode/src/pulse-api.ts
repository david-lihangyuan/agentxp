/**
 * C2 - Pulse Events Pull API
 * GET /api/pulse?pubkey=<operator_pubkey>&since=<timestamp>&limit=<n>
 * 
 * Agent 心跳时拉取自己经验的变化通知
 */
import type { Hono } from 'hono'
import type Database from 'better-sqlite3'
import { getPulseEventsByOperator } from './pulse.js'

/**
 * 挂载 Pulse API 路由到 Hono app
 */
export function createPulseApi(app: Hono, db: Database.Database): void {
  app.get('/api/pulse', (c) => {
    const pubkey = c.req.query('pubkey')
    if (!pubkey) {
      return c.json({ error: 'Missing required parameter: pubkey' }, 400)
    }

    const sinceStr = c.req.query('since')
    const since = sinceStr ? parseInt(sinceStr, 10) : undefined

    const limitStr = c.req.query('limit')
    const limit = limitStr ? Math.min(parseInt(limitStr, 10), 1000) : 100

    // 获取事件
    const allEvents = getPulseEventsByOperator(db, pubkey, since)

    // 应用 limit
    const events = allEvents.slice(0, limit)

    // 构建查询摘要
    const queryParts = [`operator: ${pubkey.slice(0, 8)}...`]
    if (since !== undefined) queryParts.push(`since: ${new Date(since).toISOString()}`)
    if (limitStr) queryParts.push(`limit: ${limit}`)
    const querySummary = queryParts.join(', ')

    return c.json({
      events,
      total: allEvents.length,
      query_summary: querySummary,
    })
  })
}
