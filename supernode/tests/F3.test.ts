// F3 Test Suite: Weekly Report Generator
// TDD: narrative generation, cron scheduling, DB storage and retrieval.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import { runMigrations } from '../src/db'
import { ExperienceStore } from '../src/agentxp/experience-store'
import { CircuitBreaker } from '../src/circuit-breaker'
import { generateReport, getCronJobs } from '../src/agentxp/weekly-report'
import { createApp } from '../src/app'

async function makeAgent() {
  const opKey = await generateOperatorKey()
  const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)
  return { opKey, agentKey }
}

async function publishExperience(
  db: Database.Database,
  store: ExperienceStore,
  agentKey: Awaited<ReturnType<typeof delegateAgentKey>>,
  overrides: Record<string, unknown> = {}
): Promise<number> {
  const payload = {
    type: 'experience',
    data: {
      what: 'Docker DNS resolution failure',
      tried: 'Restarted Docker daemon',
      outcome: 'succeeded',
      learned: 'Restart clears DNS cache',
      ...overrides,
    },
  }
  const unsigned = createEvent('intent.broadcast', payload, ['docker', 'networking'])
  const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
  const event = await signEvent(withOp, agentKey)
  const result = store.store(event)
  if (!result.ok || !result.experienceId) throw new Error('Failed to store experience')
  return result.experienceId
}

describe('F3: Weekly Report Generator', () => {
  let db: Database.Database
  let store: ExperienceStore
  let circuitBreaker: CircuitBreaker

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    circuitBreaker = new CircuitBreaker({ threshold: 10000 })
    store = new ExperienceStore(db, circuitBreaker)
  })

  // Test 1: Report generates narrative (not just numbers)
  it('generates narrative that is story-form and > 100 chars', async () => {
    const { opKey, agentKey } = await makeAgent()
    await publishExperience(db, store, agentKey)

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 7)
    const report = await generateReport(db, opKey.publicKey, weekStart)
    expect(report).toBeDefined()
    expect(report.narrative).toBeDefined()
    expect(typeof report.narrative).toBe('string')
    expect(report.narrative.length).toBeGreaterThan(100)
    // Must NOT start with a plain number (story-form)
    expect(report.narrative).not.toMatch(/^\d+/)
  })

  // Test 2: Report includes reflection highlights
  it('report includes reflection_highlights array', async () => {
    const { opKey, agentKey } = await makeAgent()
    await publishExperience(db, store, agentKey)

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 7)
    const report = await generateReport(db, opKey.publicKey, weekStart)
    expect(report.reflection_highlights).toBeDefined()
    expect(Array.isArray(report.reflection_highlights)).toBe(true)
  })

  // Test 3: Report includes network impact
  it('report includes network_impact with hits, verified, pulse_changes', async () => {
    const { opKey, agentKey } = await makeAgent()
    await publishExperience(db, store, agentKey)

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 7)
    const report = await generateReport(db, opKey.publicKey, weekStart)
    expect(report.network_impact).toBeDefined()
    expect(typeof report.network_impact.hits).toBe('number')
    expect(typeof report.network_impact.verified).toBe('number')
    expect(typeof report.network_impact.pulse_changes).toBe('number')
  })

  // Test 4: Report includes rank
  it('report includes rank as a number', async () => {
    const { opKey, agentKey } = await makeAgent()
    await publishExperience(db, store, agentKey)

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 7)
    const report = await generateReport(db, opKey.publicKey, weekStart)
    expect(typeof report.rank).toBe('number')
    expect(report.rank).toBeGreaterThanOrEqual(1)
  })

  // Test 5: Cron job scheduled for Monday 09:00 local time
  it('getCronJobs includes weekly-report on Monday 09:00', () => {
    const cronJobs = getCronJobs()
    const weeklyReport = cronJobs.find(j => j.name === 'weekly-report')
    expect(weeklyReport).toBeDefined()
    expect(weeklyReport!.schedule).toBe('0 9 * * 1')
  })

  // Test 6: Report stored in DB and retrievable via API
  it('GET /api/v1/dashboard/operator/:pubkey/weekly-report returns stored report', async () => {
    const { opKey, agentKey } = await makeAgent()
    const app = createApp({ db })

    // Publish an experience first
    const payload = {
      type: 'experience',
      data: {
        what: 'Docker DNS issue',
        tried: 'restart',
        outcome: 'succeeded',
        learned: 'restart works',
      },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['docker'])
    const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
    const event = await signEvent(withOp, agentKey)
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    })

    // Generate and store a report
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 7)
    const report = await generateReport(db, opKey.publicKey, weekStart)

    // Store the report in DB (via operator_notifications table)
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT INTO operator_notifications (operator_pubkey, type, content, created_at)
      VALUES (?, 'weekly_report', ?, ?)
    `).run(opKey.publicKey, JSON.stringify(report), now)

    // Retrieve via API
    const res = await app.request(`/api/v1/dashboard/operator/${opKey.publicKey}/weekly-report`)
    expect(res.status).toBe(200)
    const data = await res.json() as Record<string, unknown>
    expect(data['narrative']).toBeDefined()
    expect(data['reflection_highlights']).toBeDefined()
    expect(data['network_impact']).toBeDefined()
  })

  // Test 7: Weekly report API returns 404 for unknown operator
  it('GET weekly-report returns 404 for unknown operator', async () => {
    const app = createApp({ db })
    const unknownPubkey = 'f'.repeat(64)
    const res = await app.request(`/api/v1/dashboard/operator/${unknownPubkey}/weekly-report`)
    expect(res.status).toBe(404)
  })

  // Test 8: Weekly report API returns 404 if no report generated yet
  it('GET weekly-report returns 404 if no report exists for operator', async () => {
    const { opKey, agentKey } = await makeAgent()
    const app = createApp({ db })

    // Publish an experience so operator exists
    const payload = {
      type: 'experience',
      data: {
        what: 'Some experience',
        tried: 'tried something',
        outcome: 'succeeded',
        learned: 'learned something',
      },
    }
    const unsigned = createEvent('intent.broadcast', payload, ['test'])
    const withOp = { ...unsigned, operator_pubkey: agentKey.delegatedBy }
    const event = await signEvent(withOp, agentKey)
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    })

    // No report generated — should return 404
    const res = await app.request(`/api/v1/dashboard/operator/${opKey.publicKey}/weekly-report`)
    expect(res.status).toBe(404)
  })
})
