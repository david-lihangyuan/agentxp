/**
 * WebSocket 连接管理
 * 维护连接池、ping/pong 心跳、断线清理
 */

export interface Connection {
  id: string
  ws: WebSocket
  connectedAt: number
  lastPingAt: number
  lastPongAt: number
  alive: boolean
}

export interface ConnectionPool {
  connections: Map<string, Connection>
  count(): number
  add(id: string, ws: WebSocket): Connection
  remove(id: string): boolean
  get(id: string): Connection | undefined
  getAll(): Connection[]
  pingAll(): void
  cleanup(): number  // 返回清理数量
}

let _idCounter = 0
function generateConnectionId(): string {
  return `conn_${Date.now()}_${++_idCounter}`
}

export function createConnectionPool(pingIntervalMs = 30_000, pongTimeoutMs = 10_000): ConnectionPool {
  const connections = new Map<string, Connection>()
  let pingInterval: ReturnType<typeof setInterval> | null = null

  function startPingInterval(): void {
    if (pingInterval) return
    pingInterval = setInterval(() => {
      pingAll()
      cleanup()
    }, pingIntervalMs)
  }

  function stopPingInterval(): void {
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
  }

  function add(id: string, ws: WebSocket): Connection {
    const conn: Connection = {
      id,
      ws,
      connectedAt: Date.now(),
      lastPingAt: 0,
      lastPongAt: 0,
      alive: true,
    }
    connections.set(id, conn)
    if (connections.size === 1) {
      startPingInterval()
    }
    return conn
  }

  function remove(id: string): boolean {
    const removed = connections.delete(id)
    if (connections.size === 0) {
      stopPingInterval()
    }
    return removed
  }

  function get(id: string): Connection | undefined {
    return connections.get(id)
  }

  function getAll(): Connection[] {
    return Array.from(connections.values())
  }

  function pingAll(): void {
    const now = Date.now()
    for (const conn of connections.values()) {
      if (conn.ws.readyState === 1 /* OPEN */) {
        conn.lastPingAt = now
        conn.alive = false  // 等待 pong 来置回 true
        try {
          conn.ws.send(JSON.stringify({ type: 'ping', timestamp: now }))
        } catch {
          // 发送失败，标记为不存活
          conn.alive = false
        }
      }
    }
  }

  function cleanup(): number {
    const now = Date.now()
    let cleaned = 0
    for (const [id, conn] of connections.entries()) {
      const isStale =
        conn.ws.readyState !== 1 /* OPEN */ ||
        (conn.lastPingAt > 0 && !conn.alive && now - conn.lastPingAt > pongTimeoutMs)
      if (isStale) {
        try {
          conn.ws.close()
        } catch {
          // ignore
        }
        connections.delete(id)
        cleaned++
      }
    }
    if (connections.size === 0) {
      stopPingInterval()
    }
    return cleaned
  }

  return {
    connections,
    count: () => connections.size,
    add,
    remove,
    get,
    getAll,
    pingAll,
    cleanup,
  }
}

/**
 * 处理收到的 pong 消息
 */
export function handlePong(pool: ConnectionPool, connectionId: string): void {
  const conn = pool.get(connectionId)
  if (conn) {
    conn.alive = true
    conn.lastPongAt = Date.now()
  }
}

/**
 * WebSocket 升级处理器（用于 Hono）
 * 返回 connectionId
 */
export function onConnect(
  pool: ConnectionPool,
  ws: WebSocket,
  id?: string
): string {
  const connectionId = id ?? generateConnectionId()
  pool.add(connectionId, ws)
  return connectionId
}

export function onDisconnect(pool: ConnectionPool, connectionId: string): void {
  pool.remove(connectionId)
}
