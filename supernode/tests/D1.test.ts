// D1 Test Suite: Sanitization Engine
// TDD: high-risk = block, medium-risk = redact, clean = pass; relay-side last-resort scan.
// Also verifies relay-side B3 integration: EventHandler rejects events with sensitive content.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import { sanitize, relaySanitize } from '../src/agentxp/sanitize'
import { runMigrations } from '../src/db'
import { EventHandler } from '../src/protocol/event-handler'

describe('D1: Sanitization Engine', () => {
  it('API key is blocked', () => {
    const result = sanitize({ tried: 'set OPENAI_API_KEY=sk-abc123def456ghij', learned: 'works' })
    expect(result.action).toBe('block')
    expect(result.reason).toContain('API key')
  })

  it('private key is blocked', () => {
    const result = sanitize({ tried: 'used private key -----BEGIN PRIVATE KEY-----', learned: 'ok' })
    expect(result.action).toBe('block')
  })

  it('internal IP is redacted', () => {
    const result = sanitize({ tried: 'curl http://192.168.1.100/api', learned: 'works internally' })
    expect(result.action).toBe('redact')
    expect(result.content!['tried']).toContain('[PRIVATE_URL]')
    expect(result.content!['tried'] as string).not.toContain('192.168')
  })

  it('email is redacted', () => {
    const result = sanitize({ tried: 'sent to admin@company-internal.com', learned: 'sent' })
    expect(result.action).toBe('redact')
    expect(result.content!['tried']).toContain('[REDACTED_EMAIL]')
  })

  it('clean content passes through', () => {
    const result = sanitize({ tried: 'docker restart nginx', learned: 'clears DNS cache' })
    expect(result.action).toBe('pass')
  })

  it('relay-side last-resort scan blocks API key (even if bypassing skill)', () => {
    const injected = {
      type: 'experience',
      data: {
        what: 'test',
        tried: 'set sk-abc123def456ghijklmnopqrs',
        learned: 'x',
        outcome: 'succeeded',
      },
    }
    const relayResult = relaySanitize(injected)
    expect(relayResult.blocked).toBe(true)
  })

  it('relay-side scan passes clean content', () => {
    const clean = {
      type: 'experience',
      data: {
        what: 'Docker DNS fix',
        tried: 'docker restart nginx',
        learned: 'clears DNS cache',
        outcome: 'succeeded',
      },
    }
    const result = relaySanitize(clean)
    expect(result.blocked).toBe(false)
  })

  it('AWS access key is blocked', () => {
    const result = sanitize({
      tried: 'set AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      learned: 'configured AWS CLI',
    })
    expect(result.action).toBe('block')
    expect(result.reason).toContain('API key')
  })

  it('sk- format key detected without OPENAI prefix', () => {
    const result = sanitize({ tried: 'used sk-abcdefghijklmnopqrstuv as the token', learned: 'it worked' })
    expect(result.action).toBe('block')
  })

  it('RSA private key is blocked', () => {
    const result = sanitize({ tried: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBA...', learned: 'loaded key' })
    expect(result.action).toBe('block')
  })

  it('10.x.x.x internal IP is redacted', () => {
    const result = sanitize({ tried: 'ssh admin@10.0.0.5', learned: 'connected to staging' })
    expect(result.action).toBe('redact')
    expect(result.content!['tried']).toContain('[PRIVATE_URL]')
    expect(result.content!['tried'] as string).not.toContain('10.0.0.5')
  })

  it('172.16.x.x internal IP is redacted', () => {
    const result = sanitize({ tried: 'curl http://172.16.0.1:8080/health', learned: 'healthcheck works' })
    expect(result.action).toBe('redact')
    expect(result.content!['tried']).toContain('[PRIVATE_URL]')
  })

  it('DB connection string is blocked', () => {
    const result = sanitize({
      tried: 'connected to mongodb+srv://user:pass@cluster.mongodb.net/db',
      learned: 'connection works',
    })
    expect(result.action).toBe('block')
    expect(result.reason).toContain('DB connection string')
  })

  it('postgres connection string is blocked', () => {
    const result = sanitize({
      tried: 'used postgres://admin:secret@db.internal.com/production',
      learned: 'migration ran',
    })
    expect(result.action).toBe('block')
  })

  it('GitHub PAT (ghp_...) is blocked', () => {
    const result = sanitize({
      tried: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      learned: 'authenticated with GitHub API',
    })
    expect(result.action).toBe('block')
  })

  it('MySQL connection string is blocked', () => {
    const result = sanitize({
      tried: 'connect to mysql://root:password@localhost/appdb',
      learned: 'connected',
    })
    expect(result.action).toBe('block')
  })

  it('PostgreSQL full connection string is blocked', () => {
    const result = sanitize({
      tried: 'connect to postgresql://admin:s3cr3t@db.example.com:5432/mydb',
      learned: 'connected',
    })
    expect(result.action).toBe('block')
  })
})

describe('D1: Relay-side B3 Integration — EventHandler rejects sensitive content', () => {
  let db: Database.Database
  let handler: EventHandler

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    handler = new EventHandler(db)
  })

  it('event handler rejects event containing API key with "Sensitive content detected"', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-d1', 90)

    const payload = {
      type: 'experience',
      data: {
        what: 'test',
        tried: 'set sk-abc123def456ghijklmnopqrstuvwxyz as my token',
        outcome: 'succeeded',
        learned: 'it worked',
      },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['test'])
    const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
    const event = await signEvent(withOp, agentKey)

    const result = await handler.handleEvent(event)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Sensitive content detected')
  })

  it('event handler rejects event containing private key header', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-d1-b', 90)

    const payload = {
      type: 'experience',
      data: {
        what: '-----BEGIN PRIVATE KEY----- abc123 -----END PRIVATE KEY-----',
        tried: 'loaded key',
        outcome: 'succeeded',
        learned: 'ok',
      },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['test'])
    const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
    const event = await signEvent(withOp, agentKey)

    const result = await handler.handleEvent(event)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Sensitive content detected')
  })

  it('event handler accepts clean event normally (sanitize passes)', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-d1-c', 90)

    const payload = {
      type: 'experience',
      data: {
        what: 'Docker DNS fix',
        tried: 'docker restart daemon',
        outcome: 'succeeded',
        learned: 'restarting clears DNS cache',
      },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['docker'])
    const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
    const event = await signEvent(withOp, agentKey)

    const result = await handler.handleEvent(event)
    expect(result.ok).toBe(true)
    expect(result.stored).toBe(true)
  })
})
