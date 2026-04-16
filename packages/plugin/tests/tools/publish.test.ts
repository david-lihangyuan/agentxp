import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb, type Db } from '../../src/db.js'
import { createPublishTool } from '../../src/tools/publish.js'

describe('agentxp_publish tool', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('has correct tool definition shape', () => {
    const tool = createPublishTool(db)
    expect(tool.name).toBe('agentxp_publish')
    expect(tool.description).toBeTruthy()
    expect(tool.parameters.type).toBe('object')
    expect(tool.parameters.properties.what).toBeDefined()
    expect(tool.parameters.properties.tried).toBeDefined()
    expect(tool.parameters.properties.outcome).toBeDefined()
    expect(tool.parameters.properties.learned).toBeDefined()
    expect(tool.parameters.properties.context).toBeDefined()
    expect(tool.parameters.required).toEqual(['what', 'tried', 'outcome', 'learned'])
    expect(typeof tool.execute).toBe('function')
  })

  it('saves lesson when quality gate passes', async () => {
    const tool = createPublishTool(db)
    const result = await tool.execute({
      what: 'TypeScript strict mode issue with imports in index.ts',
      tried: 'Added .js extensions to all import paths',
      outcome: 'Build succeeded after adding extensions',
      learned: 'TypeScript ESM requires .js extensions in import paths even for index.ts files',
    })

    expect(result).toBe('Experience saved successfully.')

    // Verify it was actually stored
    const lessons = db.listLessons()
    expect(lessons.length).toBe(1)
    expect(lessons[0].what).toContain('TypeScript strict mode')
    expect(lessons[0].source).toBe('local')
  })

  it('rejects when quality gate fails — learned too short', async () => {
    const tool = createPublishTool(db)
    const result = await tool.execute({
      what: 'some issue with code',
      tried: 'tried something',
      outcome: 'it broke',
      learned: 'short',
    })

    expect(result).toContain('quality gate')
    expect(db.listLessons().length).toBe(0)
  })

  it('rejects when quality gate fails — what too short', async () => {
    const tool = createPublishTool(db)
    const result = await tool.execute({
      what: 'short',
      tried: 'tried something reasonable',
      outcome: 'it worked',
      learned: 'Always check the TypeScript compiler output for errors first',
    })

    expect(result).toContain('quality gate')
    expect(db.listLessons().length).toBe(0)
  })

  it('rejects when learned has no technical noun', async () => {
    const tool = createPublishTool(db)
    const result = await tool.execute({
      what: 'a problem with the thing that was happening',
      tried: 'tried doing the other thing',
      outcome: 'it worked out in the end',
      learned: 'always try the other thing first when the main thing does not work',
    })

    expect(result).toContain('quality gate')
    expect(db.listLessons().length).toBe(0)
  })

  it('sanitizes credentials before storing', async () => {
    const tool = createPublishTool(db)
    const result = await tool.execute({
      what: 'API key leaked in error message during deploy',
      tried: 'Removed the key sk-1234567890abcdefghij from the config',
      outcome: 'Deploy succeeded without leaking secrets',
      learned: 'Never hardcode API keys like sk-1234567890abcdefghij in config.ts files — use env vars instead',
    })

    expect(result).toBe('Experience saved successfully.')

    const lessons = db.listLessons()
    expect(lessons.length).toBe(1)
    // The sk- key should have been redacted
    expect(lessons[0].tried).toContain('[REDACTED]')
    expect(lessons[0].tried).not.toContain('sk-1234567890abcdefghij')
    expect(lessons[0].learned).toContain('[REDACTED]')
  })

  it('includes context as a tag when provided', async () => {
    const tool = createPublishTool(db)
    await tool.execute({
      what: 'PostgreSQL connection pool exhaustion in production.ts',
      tried: 'Increased pool size and added connection timeout',
      outcome: 'Connection errors stopped after pool tuning',
      learned: 'PostgreSQL connection pool size in production.ts should be tuned to match server capacity',
      context: 'database-ops',
    })

    const lessons = db.listLessons()
    expect(lessons.length).toBe(1)
    expect(lessons[0].tags).toContain('manual')
    expect(lessons[0].tags).toContain('database-ops')
  })

  it('uses default tags without context', async () => {
    const tool = createPublishTool(db)
    await tool.execute({
      what: 'ESLint config conflict with Prettier rules',
      tried: 'Added eslint-config-prettier to config.json resolve chain',
      outcome: 'No more formatting conflicts in CI',
      learned: 'eslint-config-prettier must come last in extends array in config.json to properly override',
    })

    const lessons = db.listLessons()
    expect(lessons[0].tags).toEqual(['manual'])
  })
})
