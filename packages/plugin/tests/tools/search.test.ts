import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb, type Db } from '../../src/db.js'
import { createSearchTool } from '../../src/tools/search.js'

describe('agentxp_search tool', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('has correct tool definition shape', () => {
    const tool = createSearchTool(db)
    expect(tool.name).toBe('agentxp_search')
    expect(tool.description).toBeTruthy()
    expect(tool.parameters.type).toBe('object')
    expect(tool.parameters.properties.query).toBeDefined()
    expect(tool.parameters.properties.limit).toBeDefined()
    expect(tool.parameters.required).toContain('query')
    expect(typeof tool.execute).toBe('function')
  })

  it('returns formatted output when lessons match', async () => {
    db.insertLesson({
      what: 'deploying to production server',
      tried: 'blue-green deployment strategy',
      outcome: 'zero downtime achieved',
      learned: 'always use blue-green for production deploys',
    })

    const tool = createSearchTool(db)
    const result = await tool.execute({ query: 'deployment' })

    expect(result).toContain('#')
    expect(result).toContain('deploying to production')
    expect(result).toContain('Tried:')
    expect(result).toContain('Learned:')
  })

  it('returns "No matching experiences found." for empty results', async () => {
    const tool = createSearchTool(db)
    const result = await tool.execute({ query: 'nonexistent topic xyz' })

    expect(result).toBe('No matching experiences found.')
  })

  it('returns "No matching experiences found." for empty query', async () => {
    db.insertLesson({
      what: 'something',
      tried: 'x',
      outcome: 'y',
      learned: 'z',
    })

    const tool = createSearchTool(db)
    const result = await tool.execute({ query: '' })

    expect(result).toBe('No matching experiences found.')
  })

  it('respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      db.insertLesson({
        what: `kubernetes task ${i}`,
        tried: `kubernetes approach ${i}`,
        outcome: 'ok',
        learned: `kubernetes lesson ${i}`,
      })
    }

    const tool = createSearchTool(db)
    const result = await tool.execute({ query: 'kubernetes', limit: 3 })

    // Count occurrences of "[#" which marks each lesson
    const matches = result.match(/\[#/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeLessThanOrEqual(3)
  })

  it('defaults limit to 5', async () => {
    for (let i = 0; i < 10; i++) {
      db.insertLesson({
        what: `redis task ${i}`,
        tried: `redis approach ${i}`,
        outcome: 'ok',
        learned: `redis lesson ${i}`,
      })
    }

    const tool = createSearchTool(db)
    const result = await tool.execute({ query: 'redis' })

    const matches = result.match(/\[#/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeLessThanOrEqual(5)
  })

  it('does not include outdated lessons', async () => {
    const id = db.insertLesson({
      what: 'outdated docker trick',
      tried: 'docker approach',
      outcome: 'fail',
      learned: 'deprecated docker pattern',
    })
    db.markOutdated(id)

    const tool = createSearchTool(db)
    const result = await tool.execute({ query: 'docker' })

    expect(result).toBe('No matching experiences found.')
  })

  it('formats multiple results with double newlines', async () => {
    db.insertLesson({
      what: 'nginx config issue first',
      tried: 'nginx approach A',
      outcome: 'ok',
      learned: 'nginx lesson A',
    })
    db.insertLesson({
      what: 'nginx config issue second',
      tried: 'nginx approach B',
      outcome: 'ok',
      learned: 'nginx lesson B',
    })

    const tool = createSearchTool(db)
    const result = await tool.execute({ query: 'nginx' })

    // Should have double newline between entries
    expect(result).toContain('\n\n')
    const entries = result.split('\n\n')
    expect(entries.length).toBe(2)
  })
})
