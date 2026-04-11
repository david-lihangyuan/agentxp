import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createConnectionPool,
  handlePong,
  onConnect,
  onDisconnect,
  type ConnectionPool,
} from '../src/connections.js'

// Mock WebSocket
function makeMockWs(readyState: number = 1 /* OPEN */): WebSocket {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket
}

describe('B2 - WebSocket 连接管理', () => {
  let pool: ConnectionPool

  beforeEach(() => {
    // 使用较短超时便于测试
    pool = createConnectionPool(100_000, 5_000)
  })

  describe('连接池基础操作', () => {
    it('初始连接数为 0', () => {
      expect(pool.count()).toBe(0)
    })

    it('添加连接后计数增加', () => {
      const ws = makeMockWs()
      pool.add('conn-1', ws)
      expect(pool.count()).toBe(1)
    })

    it('添加多个连接', () => {
      pool.add('conn-1', makeMockWs())
      pool.add('conn-2', makeMockWs())
      pool.add('conn-3', makeMockWs())
      expect(pool.count()).toBe(3)
    })

    it('移除连接后计数减少', () => {
      pool.add('conn-1', makeMockWs())
      pool.add('conn-2', makeMockWs())
      pool.remove('conn-1')
      expect(pool.count()).toBe(1)
    })

    it('移除不存在的连接返回 false', () => {
      expect(pool.remove('nonexistent')).toBe(false)
    })

    it('移除存在的连接返回 true', () => {
      pool.add('conn-1', makeMockWs())
      expect(pool.remove('conn-1')).toBe(true)
    })

    it('get 返回正确的连接对象', () => {
      const ws = makeMockWs()
      const conn = pool.add('conn-1', ws)
      expect(pool.get('conn-1')).toBe(conn)
    })

    it('get 不存在的 id 返回 undefined', () => {
      expect(pool.get('nonexistent')).toBeUndefined()
    })

    it('getAll 返回所有连接', () => {
      pool.add('conn-1', makeMockWs())
      pool.add('conn-2', makeMockWs())
      expect(pool.getAll()).toHaveLength(2)
    })
  })

  describe('连接元数据', () => {
    it('连接包含 connectedAt 时间戳', () => {
      const before = Date.now()
      const conn = pool.add('conn-1', makeMockWs())
      const after = Date.now()
      expect(conn.connectedAt).toBeGreaterThanOrEqual(before)
      expect(conn.connectedAt).toBeLessThanOrEqual(after)
    })

    it('连接初始 alive 为 true', () => {
      const conn = pool.add('conn-1', makeMockWs())
      expect(conn.alive).toBe(true)
    })

    it('连接包含 ws 引用', () => {
      const ws = makeMockWs()
      const conn = pool.add('conn-1', ws)
      expect(conn.ws).toBe(ws)
    })
  })

  describe('ping/pong 机制', () => {
    it('pingAll 向所有 OPEN 连接发送 ping', () => {
      const ws1 = makeMockWs(1)
      const ws2 = makeMockWs(1)
      pool.add('conn-1', ws1)
      pool.add('conn-2', ws2)
      pool.pingAll()
      expect(ws1.send).toHaveBeenCalledOnce()
      expect(ws2.send).toHaveBeenCalledOnce()
    })

    it('pingAll 不向已关闭连接发送 ping', () => {
      const ws = makeMockWs(3 /* CLOSED */)
      pool.add('conn-1', ws)
      pool.pingAll()
      expect(ws.send).not.toHaveBeenCalled()
    })

    it('ping 消息包含 type=ping 和 timestamp', () => {
      const ws = makeMockWs(1)
      pool.add('conn-1', ws)
      pool.pingAll()
      const sentMsg = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0])
      expect(sentMsg.type).toBe('ping')
      expect(typeof sentMsg.timestamp).toBe('number')
    })

    it('pingAll 后 alive 变为 false（等待 pong）', () => {
      const conn = pool.add('conn-1', makeMockWs(1))
      expect(conn.alive).toBe(true)
      pool.pingAll()
      expect(conn.alive).toBe(false)
    })

    it('handlePong 后 alive 恢复为 true', () => {
      const conn = pool.add('conn-1', makeMockWs(1))
      pool.pingAll()
      expect(conn.alive).toBe(false)
      handlePong(pool, 'conn-1')
      expect(conn.alive).toBe(true)
    })

    it('handlePong 更新 lastPongAt', () => {
      const conn = pool.add('conn-1', makeMockWs(1))
      pool.pingAll()
      handlePong(pool, 'conn-1')
      expect(conn.lastPongAt).toBeGreaterThan(0)
    })
  })

  describe('断线清理', () => {
    it('cleanup 移除已关闭的连接', () => {
      pool.add('conn-1', makeMockWs(3 /* CLOSED */))
      pool.add('conn-2', makeMockWs(1 /* OPEN */))
      const cleaned = pool.cleanup()
      expect(cleaned).toBe(1)
      expect(pool.count()).toBe(1)
    })

    it('cleanup 移除 pong 超时的连接', async () => {
      const shortTimeoutPool = createConnectionPool(100_000, 50) // 50ms pong 超时
      const ws = makeMockWs(1)
      shortTimeoutPool.add('conn-1', ws)
      shortTimeoutPool.pingAll()  // alive → false, lastPingAt 设置
      await new Promise(r => setTimeout(r, 100))  // 等待超时
      const cleaned = shortTimeoutPool.cleanup()
      expect(cleaned).toBe(1)
    })

    it('cleanup 保留正常连接', () => {
      pool.add('conn-1', makeMockWs(1))
      pool.add('conn-2', makeMockWs(1))
      const cleaned = pool.cleanup()
      expect(cleaned).toBe(0)
      expect(pool.count()).toBe(2)
    })
  })

  describe('onConnect / onDisconnect 辅助函数', () => {
    it('onConnect 返回 connectionId', () => {
      const ws = makeMockWs()
      const id = onConnect(pool, ws)
      expect(typeof id).toBe('string')
      expect(id).not.toBe('')
    })

    it('onConnect 用自定义 id', () => {
      const ws = makeMockWs()
      const id = onConnect(pool, ws, 'custom-id')
      expect(id).toBe('custom-id')
    })

    it('onConnect 增加连接计数', () => {
      const ws = makeMockWs()
      onConnect(pool, ws)
      expect(pool.count()).toBe(1)
    })

    it('onDisconnect 减少连接计数', () => {
      const ws = makeMockWs()
      const id = onConnect(pool, ws)
      expect(pool.count()).toBe(1)
      onDisconnect(pool, id)
      expect(pool.count()).toBe(0)
    })

    it('多次 onConnect 生成不同 id', () => {
      const ws1 = makeMockWs()
      const ws2 = makeMockWs()
      const id1 = onConnect(pool, ws1)
      const id2 = onConnect(pool, ws2)
      expect(id1).not.toBe(id2)
    })
  })
})
