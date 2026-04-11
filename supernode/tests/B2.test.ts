// B2 Test Suite: WebSocket Connection Management
// TDD: Tests for connection pool, ping/pong, global cap, per-operator limit.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  ConnectionManager,
  MAX_CONNECTIONS_DEFAULT,
  MAX_CONNECTIONS_PER_OPERATOR,
  MAX_MISSED_PINGS,
} from '../src/protocol/connection-manager'

// Mock WebSocket for testing
class MockWebSocket {
  readyState = 1 // OPEN
  messages: string[] = []
  closeCalled = false
  closeCode?: number
  closeReason?: string

  send(msg: string): void {
    this.messages.push(msg)
  }

  close(code?: number, reason?: string): void {
    this.closeCalled = true
    this.closeCode = code
    this.closeReason = reason
    this.readyState = 3 // CLOSED
  }
}

describe('B2: Connection Manager', () => {
  let manager: ConnectionManager

  beforeEach(() => {
    manager = new ConnectionManager({ maxConnections: 100, maxPerOperator: 3 })
  })

  afterEach(() => {
    manager.stopPingLoop()
    manager.disconnectAll()
  })

  it('connection added to pool on connect', () => {
    const ws = new MockWebSocket() as unknown as WebSocket
    const added = manager.add('conn-1', 'operator-pubkey-01', ws)
    expect(added).toBe(true)
    expect(manager.connectionCount).toBe(1)
  })

  it('connection removed from pool on disconnect', () => {
    const ws = new MockWebSocket() as unknown as WebSocket
    manager.add('conn-1', 'operator-pubkey-01', ws)
    expect(manager.connectionCount).toBe(1)
    manager.remove('conn-1')
    expect(manager.connectionCount).toBe(0)
  })

  it('multiple connections tracked independently', () => {
    const ws1 = new MockWebSocket() as unknown as WebSocket
    const ws2 = new MockWebSocket() as unknown as WebSocket
    manager.add('conn-1', 'operator-A', ws1)
    manager.add('conn-2', 'operator-B', ws2)
    expect(manager.connectionCount).toBe(2)

    manager.remove('conn-1')
    expect(manager.connectionCount).toBe(1)
    expect(manager.get('conn-2')).toBeDefined()
  })

  it('global connection cap enforced — rejects at max', () => {
    const smallManager = new ConnectionManager({ maxConnections: 3, maxPerOperator: 10 })
    for (let i = 0; i < 3; i++) {
      const ws = new MockWebSocket() as unknown as WebSocket
      const added = smallManager.add(`conn-${i}`, 'operator-A', ws)
      expect(added).toBe(true)
    }
    const overflow = new MockWebSocket() as unknown as WebSocket
    const rejected = smallManager.add('conn-overflow', 'operator-A', overflow)
    expect(rejected).toBe(false)
    expect(smallManager.connectionCount).toBe(3)
    smallManager.disconnectAll()
  })

  it('per-operator connection limit enforced', () => {
    // maxPerOperator = 3
    const operatorPubkey = 'a'.repeat(64)
    for (let i = 0; i < 3; i++) {
      const ws = new MockWebSocket() as unknown as WebSocket
      const added = manager.add(`conn-${i}`, operatorPubkey, ws)
      expect(added).toBe(true)
    }
    const ws4 = new MockWebSocket() as unknown as WebSocket
    const rejected = manager.add('conn-4', operatorPubkey, ws4)
    expect(rejected).toBe(false)
  })

  it('different operators have independent per-operator limits', () => {
    for (let i = 0; i < 3; i++) {
      const ws = new MockWebSocket() as unknown as WebSocket
      manager.add(`conn-A-${i}`, 'operator-A', ws)
    }
    // operator-B should still be able to connect
    const ws = new MockWebSocket() as unknown as WebSocket
    const added = manager.add('conn-B-0', 'operator-B', ws)
    expect(added).toBe(true)
  })

  it('ping increments missedPings counter', () => {
    const ws = new MockWebSocket() as unknown as WebSocket
    manager.add('conn-1', 'operator-A', ws)
    manager.pingAll()
    const conn = manager.get('conn-1')
    expect(conn).toBeDefined()
    expect(conn!.missedPings).toBe(1)
  })

  it('pong resets missedPings to 0', () => {
    const ws = new MockWebSocket() as unknown as WebSocket
    manager.add('conn-1', 'operator-A', ws)
    manager.pingAll() // missedPings = 1
    manager.pingAll() // missedPings = 2
    manager.recordPong('conn-1') // reset
    const conn = manager.get('conn-1')
    expect(conn!.missedPings).toBe(0)
  })

  it('dead connection removed after MAX_MISSED_PINGS pings', () => {
    const ws = new MockWebSocket() as unknown as WebSocket
    manager.add('conn-dead', 'operator-A', ws)
    // Simulate missing MAX_MISSED_PINGS pings (connection reaches limit)
    // Each pingAll: if missedPings >= MAX_MISSED_PINGS, disconnect
    for (let i = 0; i <= MAX_MISSED_PINGS; i++) {
      manager.pingAll()
    }
    expect(manager.connectionCount).toBe(0)
    expect((ws as unknown as MockWebSocket).closeCalled).toBe(true)
  })

  it('isFull returns true when at cap', () => {
    const fullManager = new ConnectionManager({ maxConnections: 2, maxPerOperator: 10 })
    const ws1 = new MockWebSocket() as unknown as WebSocket
    const ws2 = new MockWebSocket() as unknown as WebSocket
    fullManager.add('c1', 'op1', ws1)
    fullManager.add('c2', 'op2', ws2)
    expect(fullManager.isFull()).toBe(true)
    fullManager.disconnectAll()
  })

  it('broadcast sends message to all connections', () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()
    manager.add('c1', 'op1', ws1 as unknown as WebSocket)
    manager.add('c2', 'op2', ws2 as unknown as WebSocket)
    manager.broadcast('{"type":"test"}')
    expect(ws1.messages).toContain('{"type":"test"}')
    expect(ws2.messages).toContain('{"type":"test"}')
  })

  it('broadcastToOperator sends only to that operator', () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()
    manager.add('c1', 'op-A', ws1 as unknown as WebSocket)
    manager.add('c2', 'op-B', ws2 as unknown as WebSocket)
    manager.broadcastToOperator('op-A', '{"type":"for-A"}')
    expect(ws1.messages).toContain('{"type":"for-A"}')
    expect(ws2.messages.length).toBe(0)
  })
})

describe('B2: Connection Manager defaults', () => {
  it('default max connections is 1000', () => {
    const manager = new ConnectionManager()
    expect(manager.maxConnections).toBe(MAX_CONNECTIONS_DEFAULT)
  })

  it('default max per operator is 10', () => {
    const manager = new ConnectionManager()
    expect(manager.maxPerOperator).toBe(MAX_CONNECTIONS_PER_OPERATOR)
  })
})
