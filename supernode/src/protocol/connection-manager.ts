// Supernode — WebSocket Connection Manager
// Manages the connection pool with ping/pong keepalive and disconnect cleanup.
// Enforces global connection cap and per-operator limit.

import { logger } from '../logger'

export const PING_INTERVAL_MS = 30_000    // 30s between pings
export const MAX_MISSED_PINGS = 3         // Disconnect after 3 missed pongs
export const MAX_CONNECTIONS_DEFAULT = 1000
export const MAX_CONNECTIONS_PER_OPERATOR = 10

export interface Connection {
  id: string
  operatorPubkey: string
  ws: WebSocket
  missedPings: number
  lastPingAt: number
  connectedAt: number
}

export class ConnectionManager {
  private connections: Map<string, Connection> = new Map()
  private operatorConnections: Map<string, Set<string>> = new Map()
  private pingInterval: ReturnType<typeof setInterval> | null = null
  readonly maxConnections: number
  readonly maxPerOperator: number

  constructor(opts: {
    maxConnections?: number
    maxPerOperator?: number
  } = {}) {
    this.maxConnections = opts.maxConnections ?? MAX_CONNECTIONS_DEFAULT
    this.maxPerOperator = opts.maxPerOperator ?? MAX_CONNECTIONS_PER_OPERATOR
  }

  /** Total number of active connections. */
  get connectionCount(): number {
    return this.connections.size
  }

  /** Check if global cap is reached. */
  isFull(): boolean {
    return this.connections.size >= this.maxConnections
  }

  /** Check if operator has reached their per-operator limit. */
  isOperatorFull(operatorPubkey: string): boolean {
    const opConns = this.operatorConnections.get(operatorPubkey)
    return (opConns?.size ?? 0) >= this.maxPerOperator
  }

  /** Add a connection to the pool. Returns false if cap is reached. */
  add(id: string, operatorPubkey: string, ws: WebSocket): boolean {
    if (this.isFull()) {
      logger.warn('Connection rejected: global cap reached', {
        connectionCount: this.connections.size,
      })
      return false
    }

    if (this.isOperatorFull(operatorPubkey)) {
      logger.warn('Connection rejected: per-operator cap reached', {
        operatorPubkey,
      })
      return false
    }

    this.connections.set(id, {
      id,
      operatorPubkey,
      ws,
      missedPings: 0,
      lastPingAt: Date.now(),
      connectedAt: Date.now(),
    })

    const opConns = this.operatorConnections.get(operatorPubkey) ?? new Set()
    opConns.add(id)
    this.operatorConnections.set(operatorPubkey, opConns)

    logger.info('Connection added', {
      connectionId: id,
      operatorPubkey,
      totalConnections: this.connections.size,
    })
    return true
  }

  /** Remove a connection from the pool. */
  remove(id: string): void {
    const conn = this.connections.get(id)
    if (!conn) return

    this.connections.delete(id)

    const opConns = this.operatorConnections.get(conn.operatorPubkey)
    if (opConns) {
      opConns.delete(id)
      if (opConns.size === 0) {
        this.operatorConnections.delete(conn.operatorPubkey)
      }
    }

    logger.info('Connection removed', {
      connectionId: id,
      operatorPubkey: conn.operatorPubkey,
      totalConnections: this.connections.size,
    })
  }

  /** Get a connection by ID. */
  get(id: string): Connection | undefined {
    return this.connections.get(id)
  }

  /** Record a pong received for a connection. */
  recordPong(id: string): void {
    const conn = this.connections.get(id)
    if (conn) {
      conn.missedPings = 0
    }
  }

  /** Send ping to all connections and disconnect those that missed too many. */
  pingAll(): void {
    for (const [id, conn] of this.connections) {
      if (conn.missedPings >= MAX_MISSED_PINGS) {
        logger.warn('Disconnecting dead connection', {
          connectionId: id,
          missedPings: conn.missedPings,
        })
        try {
          conn.ws.close(1001, 'ping timeout')
        } catch {
          // Already closed
        }
        this.remove(id)
        continue
      }

      try {
        // WebSocket ping frame
        conn.ws.send(JSON.stringify({ type: 'ping' }))
        conn.missedPings++
        conn.lastPingAt = Date.now()
      } catch {
        this.remove(id)
      }
    }
  }

  /** Start background ping/pong maintenance. */
  startPingLoop(intervalMs: number = PING_INTERVAL_MS): void {
    if (this.pingInterval) return
    this.pingInterval = setInterval(() => this.pingAll(), intervalMs)
  }

  /** Stop background ping/pong maintenance. */
  stopPingLoop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  /** Broadcast a message to all connections for a given operator. */
  broadcastToOperator(operatorPubkey: string, message: string): void {
    const opConns = this.operatorConnections.get(operatorPubkey)
    if (!opConns) return

    for (const id of opConns) {
      const conn = this.connections.get(id)
      if (conn) {
        try {
          conn.ws.send(message)
        } catch {
          this.remove(id)
        }
      }
    }
  }

  /** Broadcast to all connections. */
  broadcast(message: string): void {
    for (const [id, conn] of this.connections) {
      try {
        conn.ws.send(message)
      } catch {
        this.remove(id)
      }
    }
  }

  /** Get all connection IDs. */
  getAllIds(): string[] {
    return Array.from(this.connections.keys())
  }

  /** Disconnect all connections (cleanup). */
  disconnectAll(): void {
    for (const [id, conn] of this.connections) {
      try {
        conn.ws.close(1001, 'server shutdown')
      } catch {
        // Already closed
      }
    }
    this.connections.clear()
    this.operatorConnections.clear()
  }
}

/** Singleton connection manager */
export const connectionManager = new ConnectionManager()
