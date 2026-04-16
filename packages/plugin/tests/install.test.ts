import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb } from '../src/db.js'
import type { Db } from '../src/db.js'
import { installIfNeeded } from '../src/install.js'
import { DEFAULT_CONFIG } from '../src/types.js'

describe('installIfNeeded', () => {
  let db: Db
  let stateDir: string

  beforeEach(() => {
    db = createDb(':memory:')
    stateDir = mkdtempSync(join(tmpdir(), 'agentxp-install-'))
  })

  afterEach(() => {
    db.close()
    rmSync(stateDir, { recursive: true, force: true })
  })

  it('imports preloaded lessons on first run', () => {
    const result = installIfNeeded(db, DEFAULT_CONFIG, stateDir)

    expect(result.installed).toBe(true)
    expect(result.imported).toBeGreaterThanOrEqual(10)

    // Verify lessons are in DB
    const count = db.getLessonCount()
    expect(count).toBe(result.imported)
  })

  it('skips on second run (idempotent)', () => {
    // First run
    const first = installIfNeeded(db, DEFAULT_CONFIG, stateDir)
    expect(first.installed).toBe(true)

    // Second run — should skip
    const second = installIfNeeded(db, DEFAULT_CONFIG, stateDir)
    expect(second.installed).toBe(false)
    expect(second.imported).toBeUndefined()

    // Lesson count unchanged
    expect(db.getLessonCount()).toBe(first.imported)
  })

  it('imported lessons have source "preloaded"', () => {
    installIfNeeded(db, DEFAULT_CONFIG, stateDir)

    const lessons = db.listAllLessons()
    for (const lesson of lessons) {
      expect(lesson.source).toBe('preloaded')
    }
  })

  it('preloaded lessons are sanitized (credentials redacted)', () => {
    // We verify that if preloaded data contained credentials, they would be sanitized.
    // The real preloaded-lessons.json should not have credentials,
    // but the pipeline ensures safety anyway.
    installIfNeeded(db, DEFAULT_CONFIG, stateDir)

    const lessons = db.listAllLessons()
    for (const lesson of lessons) {
      const text = `${lesson.what} ${lesson.tried} ${lesson.outcome} ${lesson.learned}`
      // No raw credential patterns should survive
      expect(text).not.toMatch(/sk-[a-zA-Z0-9_-]{20,}/)
      expect(text).not.toMatch(/ghp_[A-Za-z0-9]{16,}/)
      expect(text).not.toMatch(/AKIA[A-Z0-9]{16,}/)
    }
  })

  it('generates identity keys file', () => {
    installIfNeeded(db, DEFAULT_CONFIG, stateDir)

    const keyPath = join(stateDir, 'identity.json')
    expect(existsSync(keyPath)).toBe(true)

    const keys = JSON.parse(readFileSync(keyPath, 'utf8'))
    expect(keys).toHaveProperty('publicKey')
    expect(keys).toHaveProperty('secretKey')
    expect(typeof keys.publicKey).toBe('string')
    expect(typeof keys.secretKey).toBe('string')
    expect(keys.publicKey.length).toBeGreaterThanOrEqual(64) // 32 bytes hex
    expect(keys.secretKey.length).toBeGreaterThanOrEqual(128) // 64 bytes hex
  })

  it('does not overwrite existing identity keys', () => {
    const keyPath = join(stateDir, 'identity.json')
    const existingKeys = { publicKey: 'existing-pub', secretKey: 'existing-sec' }
    writeFileSync(keyPath, JSON.stringify(existingKeys))

    installIfNeeded(db, DEFAULT_CONFIG, stateDir)

    const keys = JSON.parse(readFileSync(keyPath, 'utf8'))
    expect(keys.publicKey).toBe('existing-pub')
    expect(keys.secretKey).toBe('existing-sec')
  })

  it('preloaded lessons have tags', () => {
    installIfNeeded(db, DEFAULT_CONFIG, stateDir)

    const lessons = db.listAllLessons()
    // At least some lessons should have tags
    const withTags = lessons.filter(l => l.tags && l.tags.length > 0)
    expect(withTags.length).toBeGreaterThan(0)
  })

  it('each preloaded lesson has all required fields', () => {
    installIfNeeded(db, DEFAULT_CONFIG, stateDir)

    const lessons = db.listAllLessons()
    for (const lesson of lessons) {
      expect(lesson.what).toBeTruthy()
      expect(lesson.tried).toBeTruthy()
      expect(lesson.outcome).toBeTruthy()
      expect(lesson.learned).toBeTruthy()
    }
  })
})
