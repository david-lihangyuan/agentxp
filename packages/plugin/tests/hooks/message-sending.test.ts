import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../../src/db.js'
import type { Db } from '../../src/db.js'
import { createMessageSendingHook, extractKeywords } from '../../src/hooks/message-sending.js'
import { getLastActiveSession, resetState } from '../../src/hooks/state.js'

describe('extractKeywords', () => {
  it('extracts non-stopword tokens', () => {
    const kw = extractKeywords('the vitest framework is great for testing')
    expect(kw).toContain('vitest')
    expect(kw).toContain('framework')
    expect(kw).toContain('great')
    expect(kw).toContain('testing')
    expect(kw).not.toContain('the')
    expect(kw).not.toContain('is')
    expect(kw).not.toContain('for')
  })

  it('prioritizes technical terms (PascalCase, dots, slashes)', () => {
    const kw = extractKeywords('Using TypeScript with node/path module for db.ts file')
    // Technical terms should appear before non-technical terms
    const techTerms = ['TypeScript', 'node/path', 'db.ts']
    for (const t of techTerms) {
      expect(kw).toContain(t)
    }
    // All technical terms should be before non-technical ones like 'using', 'module', 'file'
    const firstNonTech = kw.findIndex(k => !techTerms.includes(k))
    const lastTech = Math.max(...techTerms.map(t => kw.indexOf(t)))
    if (firstNonTech >= 0) {
      expect(lastTech).toBeLessThan(firstNonTech)
    }
  })

  it('extracts CJK bigrams and filters stopword bigrams', () => {
    const kw = extractKeywords('这是一个测试，用来验证中文关键词提取')
    // Should extract meaningful bigrams like 测试, 验证, 关键, etc.
    expect(kw).toContain('测试')
    expect(kw).toContain('验证')
    expect(kw).toContain('关键')
    // Pure stopword bigrams like 这是 (both are stopwords) should be filtered
    expect(kw).not.toContain('这是')
  })

  it('limits to 20 keywords', () => {
    const text = Array.from({ length: 30 }, (_, i) => `keyword${i}`).join(' ')
    const kw = extractKeywords(text)
    expect(kw.length).toBeLessThanOrEqual(20)
  })

  it('deduplicates case-insensitively', () => {
    const kw = extractKeywords('React react REACT component')
    const reactCount = kw.filter(k => k.toLowerCase() === 'react').length
    expect(reactCount).toBe(1)
  })

  it('returns empty for empty input', () => {
    expect(extractKeywords('')).toEqual([])
    expect(extractKeywords('the is a')).toEqual([])
  })

  it('strips trailing punctuation', () => {
    const kw = extractKeywords('vitest, typescript! react?')
    expect(kw).toContain('vitest')
    expect(kw).toContain('typescript')
    expect(kw).toContain('react')
  })
})

describe('message_sending hook', () => {
  let db: Db

  beforeEach(() => {
    db = createDb(':memory:')
    resetState()
  })

  afterEach(() => {
    db.close()
    resetState()
  })

  it('updates context_cache with extracted keywords', () => {
    const hook = createMessageSendingHook(db)

    hook(
      { to: 'user', content: 'Using vitest for TypeScript testing' },
      { channelId: 'ch-1', conversationId: 'conv-1' },
    )

    const cache = db.getContextCache('conv-1')
    expect(cache).not.toBeNull()
    expect(cache!.keywords).toContain('vitest')
    expect(cache!.keywords).toContain('TypeScript')
  })

  it('uses conversationId as session key when available', () => {
    const hook = createMessageSendingHook(db)

    hook(
      { to: 'user', content: 'vitest testing' },
      { channelId: 'ch-1', conversationId: 'conv-1' },
    )

    expect(db.getContextCache('conv-1')).not.toBeNull()
    expect(db.getContextCache('ch-1')).toBeNull()
  })

  it('falls back to channelId when conversationId is absent', () => {
    const hook = createMessageSendingHook(db)

    hook(
      { to: 'user', content: 'vitest testing' },
      { channelId: 'ch-1' },
    )

    expect(db.getContextCache('ch-1')).not.toBeNull()
  })

  it('updates lastActiveSession on keyword extraction', () => {
    const hook = createMessageSendingHook(db)

    hook(
      { to: 'user', content: 'vitest TypeScript' },
      { channelId: 'ch-1', conversationId: 'conv-42' },
    )

    expect(getLastActiveSession()).toBe('conv-42')
  })

  it('does not update cache for messages with only stopwords', () => {
    const hook = createMessageSendingHook(db)

    hook(
      { to: 'user', content: 'the is a an' },
      { channelId: 'ch-1' },
    )

    expect(db.getContextCache('ch-1')).toBeNull()
    expect(getLastActiveSession()).toBeUndefined()
  })

  it('never throws even if db throws', () => {
    const brokenDb = {
      ...db,
      upsertContextCache: () => { throw new Error('DB exploded') },
    } as unknown as Db

    const hook = createMessageSendingHook(brokenDb)

    // Should not throw
    expect(() => {
      hook(
        { to: 'user', content: 'vitest TypeScript testing' },
        { channelId: 'ch-1' },
      )
    }).not.toThrow()
  })
})
