import { describe, it, expect } from 'vitest'
import { extractKeywords } from '../src/hooks/message-sending.js'
import { inferPhase, scoreLessonForPhase, selectExperiences } from '../src/injection-engine.js'
import { createDb } from '../src/db.js'
import { DEFAULT_CONFIG } from '../src/types.js'

describe('debug injection', () => {
  it('debug', () => {
    const keywords = extractKeywords('I fixed the TypeScript ESM import error by adding .js extensions')
    console.log('Keywords:', JSON.stringify(keywords))
    console.log('Phase:', inferPhase(keywords))

    const db = createDb(':memory:')
    db.insertLesson({
      what: 'ModuleNotFoundError encountered in src/index.ts',
      tried: 'Added .js extensions to all relative imports',
      outcome: 'Build succeeded after fixing ESM import paths',
      learned: 'TypeScript ESM projects require .js extensions in import paths. ModuleNotFoundError is the symptom.',
      source: 'local',
      tags: ['typescript', 'esm', 'error', 'auto-extracted'],
    })

    const query = keywords.join(' ')
    console.log('FTS query:', query)
    const results = db.searchLessons(query, 10)
    console.log('Search results count:', results.length)
    if (results.length > 0) {
      console.log('Score:', scoreLessonForPhase(results[0], inferPhase(keywords)))
    }

    // Now try selectExperiences
    const config = { ...DEFAULT_CONFIG, weaning: { enabled: false, rate: 0 } }
    const result = selectExperiences({
      keywords,
      db,
      config,
      _randomFn: () => 0.99,
    })
    console.log('Injection result:', JSON.stringify(result, null, 2))

    db.close()
  })
})
