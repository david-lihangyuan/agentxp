// Supernode — WebSocket Connection Manager
// Manages WebSocket connection pool, ping/pong health checks,
// global cap (1000), per-operator cap (10), and clean disconnect.

export const MAX_CONNECTIONS_DEFAULT = 1000
export const MAX_CONNECTIONS_PER_OPERATOR = 10
export const MAX_MISSED_PINGS = 3
export const PING_INTERVAL_MS = 30_000

export interface ConnectionRecord {
  id: string
  operatorPubkey: string
  ws: WebSocket
  missedPings: number
  connectedAt: number
}

export interface ConnectionManagerOptions {
  /** Global max connections. Default: MAX_CONNECTIONS_DEFAULT */
  maxConnections?: number
  /** Max connections per operator pubkey. Default: MAX_CONNECTIONS_PER_OPERATOR */
  maxPerOperator?: number
  /** Ping interval in ms. Default: PING_INTERVAL_MS */
  pingIntervalMs?: number
}

export class ConnectionManager {
  readonly maxConnections: number
  readonly maxPerOperator: number
  private pingIntervalMs: number
  private connections: Map<string, ConnectionRecord> = new Map()
  private operatorCounts: Map<string, number> = new Map()
  private pingTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: ConnectionManagerOptions = {}) {
    this.maxConnections = opts.maxConnections ?? MAX_CONNECTIONS_DEFAULT
    this.maxPerOperator = opts.maxPerOperator ?? MAX_CONNECTIONS_PER_OPERATOR
    this.pingIntervalMs = opts.pingIntervalMs ?? PING_INTERVAL_MS
  }

  /** Current number of active connections. */
  get connectionCount(): number {
    return this.connections.size
  }

  /** Whether the global cap has been reached. */
  isFull(): boolean {
    return this.connections.size >= this.maxConnections
  }

  /**
   * Add a connection to the pool.
   * Returns false if global cap or per-operator cap is reached.
   */
  add(connectionId: string, operatorPubkey: string, ws: WebSocket): boolean {
    // Global cap check
    if (this.connections.size >= this.maxConnections) {
      return false
    }

    // Per-operator cap check
    const operatorCount = this.operatorCounts.get(operatorPubkey) ?? 0
    if (operatorCount >= this.maxPerOperator) {
      return false
    }

    const record: ConnectionRecord = {
      id: connectionId,
      operatorPubkey,
      ws,
      missedPings: 0,
      connectedAt: Date.now(),
    }

    this.connections.set(connectionId, record)
    this.operatorCounts.set(operatorPubkey, operatorCount + 1)
    return true
  }

  /** Remove a connection from the pool. */
  remove(connectionId: string): void {
    const record = this.connections.get(connectionId)
    if (!record) return

    this.connections.delete(connectionId)

    const operatorCount = this.operatorCounts.get(record.operatorPubkey) ?? 1
    if (operatorCount <= 1) {
      this.operatorCounts.delete(record.operatorPubkey)
    } else {
      this.operatorCounts.set(record.operatorPubkey, operatorCount - 1)
    }
  }

  /** Get a connection record by ID. */
  get(connectionId: string): ConnectionRecord | undefined {
    return this.connections.get(connectionId)
  }

  /**
   * Send a ping to all connections.
   * Increments missedPings for each connection.
   * If a connection exceeds MAX_MISSED_PINGS, it is disconnected.
   */
  pingAll(): void {
    for (const [id, record] of this.connections) {
      if (record.missedPings >= MAX_MISSED_PINGS) {
        // Too many missed pings — disconnect
        record.ws.close(1008, 'ping timeout')
        this.remove(id)
        continue
      }

      record.missedPings++
      try {
        record.ws.send(JSON.stringify({ type: 'ping' }))
      } catch {
        // Connection may be broken — remove it
        this.remove(id)
      }
    }
  }

  /** Record a pong from a connection — resets missedPings to 0. */
  recordPong(connectionId: string): void {
    const record = this.connections.get(connectionId)
    if (record) {
      record.missedPings = 0
    }
  }

  /** Start the automatic ping loop. */
  startPingLoop(): void {
    if (this.pingTimer) return
    this.pingTimer = setInterval(() => {
      this.pingAll()
    }, this.pingIntervalMs)
  }

  /** Stop the automatic ping loop. */
  stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  /** Broadcast a message to all connected clients. */
  broadcast(message: string): void {
    for (const [id, record] of this.connections) {
      try {
        record.ws.send(message)
      } catch {
        this.remove(id)
      }
    }
  }

  /** Broadcast a message to all connections for a specific operator. */
  broadcastToOperator(operatorPubkey: string, message: string): void {
    for (const [id, record] of this.connections) {
      if (record.operatorPubkey === operatorPubkey) {
        try {
          record.ws.send(message)
        } catch {
          this.remove(id)
        }
      }
    }
  }

  /** Disconnect all connections and clear the pool. */
  disconnectAll(): void {
    for (const [id, record] of this.connections) {
      try {
        record.ws.close(1001, 'server shutting down')
      } catch {
        // Ignore errors during shutdown
      }
    }
    this.connections.clear()
    this.operatorCounts.clear()
  }
}
