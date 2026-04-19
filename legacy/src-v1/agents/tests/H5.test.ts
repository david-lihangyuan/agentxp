/**
 * H5.test.ts
 * Tests for pulse feedback → CURIOSITY.md update logic
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  analyzePulseEvents,
  updateNetworkSignalsSection,
  markBranchComplete,
  type PulseEvent,
} from '../scripts/update-curiosity.js'
import { generateCuriosityContent } from '../scripts/init-curiosity.js'

const TMP_DIR = resolve(__dirname, '../.tmp-h5-tests')

function setupTmpDir() {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true })
  }
}

function cleanup(paths: string[]) {
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {}
    }
  }
}

describe('H5: analyzePulseEvents', () => {
  it('identifies demand hotspot (50+ searches with no results)', () => {
    const events: PulseEvent[] = [
      {
        query: 'kubernetes rate limiting',
        search_count: 55,
        result_count: 0,
        timestamp: new Date().toISOString(),
      },
    ]
    const signals = analyzePulseEvents(events)
    expect(signals.some((s) => s.query === 'kubernetes rate limiting')).toBe(true)
    expect(signals.some((s) => s.type === 'hotspot')).toBe(true)
  })

  it('identifies white space (zero results returned)', () => {
    const events: PulseEvent[] = [
      {
        query: 'cross-framework auth patterns',
        search_count: 5,
        result_count: 0,
        timestamp: new Date().toISOString(),
      },
    ]
    const signals = analyzePulseEvents(events)
    expect(signals.some((s) => s.query === 'cross-framework auth patterns')).toBe(
      true
    )
    expect(signals.some((s) => s.type === 'white-space')).toBe(true)
  })

  it('does not flag queries with results as white space', () => {
    const events: PulseEvent[] = [
      {
        query: 'docker networking',
        search_count: 10,
        result_count: 3,
        timestamp: new Date().toISOString(),
      },
    ]
    const signals = analyzePulseEvents(events)
    expect(signals.some((s) => s.query === 'docker networking')).toBe(false)
  })

  it('hotspot threshold is 50 searches', () => {
    const below: PulseEvent[] = [
      { query: 'test query', search_count: 49, result_count: 0, timestamp: '' },
    ]
    const above: PulseEvent[] = [
      { query: 'test query', search_count: 50, result_count: 0, timestamp: '' },
    ]

    const signalsBelow = analyzePulseEvents(below)
    const signalsAbove = analyzePulseEvents(above)

    // Below threshold: white space only, not hotspot
    expect(signalsBelow.every((s) => s.type !== 'hotspot')).toBe(true)
    // At threshold: hotspot
    expect(signalsAbove.some((s) => s.type === 'hotspot')).toBe(true)
  })
})

describe('H5: updateNetworkSignalsSection', () => {
  it('adds HOTSPOT marker to network signals section', () => {
    const content = generateCuriosityContent('How do frameworks handle errors?')
    const events: PulseEvent[] = [
      {
        query: 'kubernetes rate limiting',
        search_count: 55,
        result_count: 0,
        timestamp: new Date().toISOString(),
      },
    ]
    const signals = analyzePulseEvents(events)
    const updated = updateNetworkSignalsSection(content, signals)

    expect(updated).toContain('kubernetes rate limiting')
    expect(updated.toUpperCase()).toContain('[HOTSPOT]')
  })

  it('adds WHITE SPACE marker for unexplored queries', () => {
    const content = generateCuriosityContent('How do frameworks handle errors?')
    const events: PulseEvent[] = [
      {
        query: 'cross-framework auth patterns',
        search_count: 5,
        result_count: 0,
        timestamp: new Date().toISOString(),
      },
    ]
    const signals = analyzePulseEvents(events)
    const updated = updateNetworkSignalsSection(content, signals)

    expect(updated).toContain('cross-framework auth patterns')
    expect(updated.toUpperCase()).toContain('[WHITE SPACE]')
  })

  it('returns content unchanged when no signals', () => {
    const content = generateCuriosityContent('How do frameworks handle errors?')
    const updated = updateNetworkSignalsSection(content, [])
    expect(updated).toBe(content)
  })
})

describe('H5: markBranchComplete', () => {
  beforeEach(setupTmpDir)
  afterEach(() => {
    cleanup([
      join(TMP_DIR, 'CURIOSITY.md'),
      join(TMP_DIR, 'CURIOSITY-ARCHIVE.md'),
    ])
  })

  it('removes branch from CURIOSITY.md and archives it', () => {
    const curiosityPath = join(TMP_DIR, 'CURIOSITY.md')
    const archivePath = join(TMP_DIR, 'CURIOSITY-ARCHIVE.md')

    const content = generateCuriosityContent('How do frameworks handle errors?') +
      '\n- docker networking patterns explored\n'
    writeFileSync(curiosityPath, content, 'utf8')

    markBranchComplete(curiosityPath, archivePath, 'docker networking')

    const main = readFileSync(curiosityPath, 'utf8')
    const archive = readFileSync(archivePath, 'utf8')

    expect(main).not.toContain('docker networking')
    expect(archive).toContain('docker networking')
  })

  it('creates CURIOSITY-ARCHIVE.md if it does not exist', () => {
    const curiosityPath = join(TMP_DIR, 'CURIOSITY.md')
    const archivePath = join(TMP_DIR, 'CURIOSITY-ARCHIVE.md')

    const content = generateCuriosityContent('root question') +
      '\n- error handling patterns noted\n'
    writeFileSync(curiosityPath, content, 'utf8')

    markBranchComplete(curiosityPath, archivePath, 'error handling patterns')

    expect(existsSync(archivePath)).toBe(true)
    const archive = readFileSync(archivePath, 'utf8')
    expect(archive).toContain('error handling patterns')
  })

  it('throws when branch topic not found', () => {
    const curiosityPath = join(TMP_DIR, 'CURIOSITY.md')
    const archivePath = join(TMP_DIR, 'CURIOSITY-ARCHIVE.md')

    writeFileSync(
      curiosityPath,
      generateCuriosityContent('some root question'),
      'utf8'
    )

    expect(() =>
      markBranchComplete(curiosityPath, archivePath, 'nonexistent topic xyz')
    ).toThrow()
  })
})
