import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb, type Db } from '../src/db.js'
import { createXpCommand, isPaused, setPaused } from '../src/commands.js'
import { DEFAULT_CONFIG, type PluginConfig } from '../src/types.js'

describe('/xp command', () => {
  let db: Db
  let config: PluginConfig

  beforeEach(() => {
    db = createDb(':memory:')
    config = { ...DEFAULT_CONFIG }
    // Reset pause state between tests
    setPaused(false)
  })

  afterEach(() => {
    db.close()
  })

  // ── Definition ─────────────────────────────────────────────────────────

  it('has correct command definition shape', () => {
    const cmd = createXpCommand(db, config)
    expect(cmd.name).toBe('xp')
    expect(cmd.description).toBeTruthy()
    expect(cmd.acceptsArgs).toBe(true)
    expect(cmd.requireAuth).toBe(true)
    expect(typeof cmd.handler).toBe('function')
  })

  // ── Status ─────────────────────────────────────────────────────────────

  it('/xp → shows status', async () => {
    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({})

    expect(result.text).toContain('AgentXP Status')
    expect(result.text).toContain('Local lessons:')
    expect(result.text).toContain('Injections:')
    expect(result.text).toContain('Mode:')
  })

  it('/xp status → shows status (explicit)', async () => {
    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'status' })

    expect(result.text).toContain('AgentXP Status')
  })

  it('status shows lesson count', async () => {
    db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    db.insertLesson({ what: 'b', tried: 'x', outcome: 'y', learned: 'z' })

    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'status' })

    expect(result.text).toContain('Local lessons: 2')
  })

  it('status shows outdated count when > 0', async () => {
    const id1 = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    db.insertLesson({ what: 'b', tried: 'x', outcome: 'y', learned: 'z' })
    db.markOutdated(id1)

    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'status' })

    expect(result.text).toContain('Local lessons: 1')
    expect(result.text).toContain('(1 outdated)')
  })

  it('status hides outdated count when 0', async () => {
    db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })

    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'status' })

    expect(result.text).not.toContain('outdated')
  })

  it('status shows injection stats', async () => {
    db.insertInjectionLog({ sessionId: 's1', injected: true, tokenCount: 100, lessonIds: [1] })
    db.insertInjectionLog({ sessionId: 's2', injected: false })
    db.insertInjectionLog({ sessionId: 's3', injected: true, tokenCount: 200, lessonIds: [2] })

    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'status' })

    expect(result.text).toContain('3 sessions')
    expect(result.text).toContain('2 injected')
    expect(result.text).toContain('67%')
  })

  it('status shows published count in network mode', async () => {
    const networkConfig = { ...config, mode: 'network' as const }
    const lessonId = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    db.insertPublishedLog({ lessonId, relayEventId: 'evt-1' })

    const cmd = createXpCommand(db, networkConfig)
    const result = await cmd.handler({ args: 'status' })

    expect(result.text).toContain('Published: 1')
    expect(result.text).toContain('network mode')
    expect(result.text).toContain('Relay:')
  })

  it('status shows active state when not paused', async () => {
    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'status' })

    expect(result.text).toContain('▶ active')
  })

  it('status shows paused state when paused', async () => {
    setPaused(true)
    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'status' })

    expect(result.text).toContain('⏸ paused')
  })

  // ── Pause ──────────────────────────────────────────────────────────────

  it('/xp pause → sets paused flag', async () => {
    expect(isPaused()).toBe(false)

    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'pause' })

    expect(isPaused()).toBe(true)
    expect(result.text).toContain('paused')
  })

  // ── Resume ─────────────────────────────────────────────────────────────

  it('/xp resume → clears paused flag', async () => {
    setPaused(true)
    expect(isPaused()).toBe(true)

    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'resume' })

    expect(isPaused()).toBe(false)
    expect(result.text).toContain('resumed')
  })

  // ── Unpublish ──────────────────────────────────────────────────────────

  it('/xp unpublish → marks last published as unpublished', async () => {
    const lessonId = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    db.insertPublishedLog({ lessonId, relayEventId: 'evt-42' })

    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'unpublish' })

    expect(result.text).toContain('Unpublished')
    expect(result.text).toContain(`#${lessonId}`)
    expect(result.text).toContain('evt-42')

    // Verify actually unpublished
    const log = db.getPublishedLog(lessonId)
    expect(log[0].unpublishedAt).toBeDefined()
  })

  it('/xp unpublish → nothing to unpublish', async () => {
    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'unpublish' })

    expect(result.text).toBe('Nothing published yet.')
  })

  it('/xp unpublish → only unpublishes the latest', async () => {
    const id1 = db.insertLesson({ what: 'a', tried: 'x', outcome: 'y', learned: 'z' })
    const id2 = db.insertLesson({ what: 'b', tried: 'x', outcome: 'y', learned: 'z' })
    db.insertPublishedLog({ lessonId: id1, relayEventId: 'evt-1', publishedAt: Date.now() - 1000 })
    db.insertPublishedLog({ lessonId: id2, relayEventId: 'evt-2', publishedAt: Date.now() })

    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'unpublish' })

    // Should unpublish the most recent one (id2)
    expect(result.text).toContain(`#${id2}`)

    // id1 should still be published
    const log1 = db.getPublishedLog(id1)
    // getLastPublish returns latest by published_at, markUnpublished operates by lessonId
    // After unpublishing id2, id1 should remain
    const lastPublish = db.getLastPublish()
    expect(lastPublish?.lessonId).toBe(id1)
  })

  // ── Unknown subcommand ─────────────────────────────────────────────────

  it('/xp unknown → error message', async () => {
    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: 'foobar' })

    expect(result.text).toContain('Unknown subcommand')
    expect(result.text).toContain('foobar')
    expect(result.text).toContain('status')
    expect(result.text).toContain('pause')
    expect(result.text).toContain('resume')
    expect(result.text).toContain('unpublish')
  })

  // ── Edge cases ─────────────────────────────────────────────────────────

  it('handles args with extra whitespace', async () => {
    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: '  pause  ' })

    expect(isPaused()).toBe(true)
    expect(result.text).toContain('paused')
  })

  it('handles undefined args (defaults to status)', async () => {
    const cmd = createXpCommand(db, config)
    const result = await cmd.handler({ args: undefined })

    expect(result.text).toContain('AgentXP Status')
  })

  it('isPaused() exported and functional', () => {
    expect(isPaused()).toBe(false)
    setPaused(true)
    expect(isPaused()).toBe(true)
    setPaused(false)
    expect(isPaused()).toBe(false)
  })
})
