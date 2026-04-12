/**
 * H8.test.ts
 * Tests for tune-params.ts — parameter tuning with human-guarded protection
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  tune,
  loadParams,
  isAutoAdjustable,
  isHumanGuarded,
  type AgentParams,
} from '../scripts/tune-params.js'

const TMP_DIR = resolve(__dirname, '../.tmp-h8-tests')
const TEST_PARAMS_PATH = join(TMP_DIR, 'params.json')

function setupTmpDir() {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true })
  }
  if (existsSync(TEST_PARAMS_PATH)) {
    unlinkSync(TEST_PARAMS_PATH)
  }
}

function teardownTmpDir() {
  if (existsSync(TEST_PARAMS_PATH)) {
    unlinkSync(TEST_PARAMS_PATH)
  }
}

describe('H8: isAutoAdjustable', () => {
  it('identifies score weights as auto-adjustable', () => {
    expect(isAutoAdjustable('score_weight_verification')).toBe(true)
    expect(isAutoAdjustable('score_weight_search_hits')).toBe(true)
    expect(isAutoAdjustable('score_weight_exploration_depth')).toBe(true)
    expect(isAutoAdjustable('score_weight_recency')).toBe(true)
  })

  it('identifies heartbeat frequency multiplier as auto-adjustable', () => {
    expect(isAutoAdjustable('heartbeat_frequency_multiplier')).toBe(true)
  })

  it('identifies SOUL.md content as NOT auto-adjustable', () => {
    expect(isAutoAdjustable('soul_content')).toBe(false)
    expect(isAutoAdjustable('soul')).toBe(false)
  })

  it('identifies BOUNDARY.md content as NOT auto-adjustable', () => {
    expect(isAutoAdjustable('boundary_content')).toBe(false)
    expect(isAutoAdjustable('boundary')).toBe(false)
  })
})

describe('H8: isHumanGuarded', () => {
  it('identifies soul and boundary params as human-guarded', () => {
    expect(isHumanGuarded('soul_content')).toBe(true)
    expect(isHumanGuarded('boundary_content')).toBe(true)
    expect(isHumanGuarded('soul')).toBe(true)
    expect(isHumanGuarded('boundary')).toBe(true)
  })

  it('identifies score weights as NOT human-guarded', () => {
    expect(isHumanGuarded('score_weight_verification')).toBe(false)
    expect(isHumanGuarded('heartbeat_frequency_multiplier')).toBe(false)
  })
})

describe('H8: tune — auto-adjustable params', () => {
  beforeEach(setupTmpDir)
  afterEach(teardownTmpDir)

  it('tunes score_weight_verification successfully', () => {
    const result = tune('score_weight_verification', 0.5, TEST_PARAMS_PATH)
    expect(result.success).toBe(true)
    expect(result.param).toBe('score_weight_verification')
    expect(result.value).toBe(0.5)
  })

  it('persists the tuned value to params file', () => {
    tune('score_weight_verification', 0.35, TEST_PARAMS_PATH)
    const params = loadParams(TEST_PARAMS_PATH)
    expect(params.score_weight_verification).toBe(0.35)
  })

  it('tunes heartbeat_frequency_multiplier', () => {
    const result = tune('heartbeat_frequency_multiplier', 1.5, TEST_PARAMS_PATH)
    expect(result.success).toBe(true)
    expect(result.value).toBe(1.5)
  })

  it('accepts string values and converts to number', () => {
    const result = tune('hotspot_threshold', '75', TEST_PARAMS_PATH)
    expect(result.success).toBe(true)
    expect(result.value).toBe(75)
  })
})

describe('H8: tune — validation', () => {
  beforeEach(setupTmpDir)
  afterEach(teardownTmpDir)

  it('rejects score weight outside 0-1 range', () => {
    expect(() =>
      tune('score_weight_verification', 1.5, TEST_PARAMS_PATH)
    ).toThrow()
    expect(() =>
      tune('score_weight_search_hits', -0.1, TEST_PARAMS_PATH)
    ).toThrow()
  })

  it('rejects heartbeat multiplier > 10', () => {
    expect(() =>
      tune('heartbeat_frequency_multiplier', 15, TEST_PARAMS_PATH)
    ).toThrow()
  })

  it('rejects non-numeric values for numeric params', () => {
    expect(() =>
      tune('score_weight_verification', 'not-a-number', TEST_PARAMS_PATH)
    ).toThrow()
  })
})

describe('H8: tune — human-guarded params are rejected', () => {
  beforeEach(setupTmpDir)
  afterEach(teardownTmpDir)

  it('throws "requires human confirmation" for soul_content', () => {
    expect(() =>
      tune('soul_content', 'some new content', TEST_PARAMS_PATH)
    ).toThrow(/requires human confirmation/i)
  })

  it('throws "requires human confirmation" for boundary_content', () => {
    expect(() =>
      tune('boundary_content', 'new limits', TEST_PARAMS_PATH)
    ).toThrow(/requires human confirmation/i)
  })

  it('throws "requires human confirmation" for soul shorthand', () => {
    expect(() => tune('soul', 'anything', TEST_PARAMS_PATH)).toThrow(
      /requires human confirmation/i
    )
  })

  it('throws "requires human confirmation" for boundary shorthand', () => {
    expect(() => tune('boundary', 'anything', TEST_PARAMS_PATH)).toThrow(
      /requires human confirmation/i
    )
  })
})

describe('H8: loadParams', () => {
  beforeEach(setupTmpDir)
  afterEach(teardownTmpDir)

  it('returns defaults when params file does not exist', () => {
    const params = loadParams(join(TMP_DIR, 'nonexistent.json'))
    expect(params.score_weight_verification).toBeDefined()
    expect(params.heartbeat_frequency_multiplier).toBeDefined()
  })

  it('merges saved values with defaults', () => {
    writeFileSync(
      TEST_PARAMS_PATH,
      JSON.stringify({ score_weight_verification: 0.99 }),
      'utf8'
    )
    const params = loadParams(TEST_PARAMS_PATH)
    expect(params.score_weight_verification).toBe(0.99)
    // Other defaults still present
    expect(params.heartbeat_frequency_multiplier).toBeDefined()
  })
})
