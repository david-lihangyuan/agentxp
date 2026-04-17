// Tests for loadABGroups — env-driven A/B experiment group configuration.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_AB_GROUPS, loadABGroups } from '../src/ab-groups'

describe('loadABGroups', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ab-groups-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the built-in defaults when path is undefined', () => {
    const groups = loadABGroups(undefined)
    expect(groups).toEqual([...DEFAULT_AB_GROUPS])
  })

  it('returns the built-in defaults when path is an empty string', () => {
    const groups = loadABGroups('')
    expect(groups).toEqual([...DEFAULT_AB_GROUPS])
  })

  it('loads a valid JSON file', () => {
    const path = join(dir, 'groups.json')
    const entries = [
      { label: 'alpha', pubkey: 'a'.repeat(64) },
      { label: 'beta', pubkey: 'b'.repeat(64) },
    ]
    writeFileSync(path, JSON.stringify(entries))
    expect(loadABGroups(path)).toEqual(entries)
  })

  it('returns an empty array for an empty JSON array', () => {
    const path = join(dir, 'groups.json')
    writeFileSync(path, '[]')
    expect(loadABGroups(path)).toEqual([])
  })

  it('throws when the file does not exist', () => {
    expect(() => loadABGroups(join(dir, 'missing.json'))).toThrow(/failed to read/)
  })

  it('throws on malformed JSON', () => {
    const path = join(dir, 'bad.json')
    writeFileSync(path, '{ not valid json')
    expect(() => loadABGroups(path)).toThrow(/invalid JSON/)
  })

  it('throws when the top-level value is not an array', () => {
    const path = join(dir, 'obj.json')
    writeFileSync(path, '{"not": "an array"}')
    expect(() => loadABGroups(path)).toThrow(/must contain a JSON array/)
  })

  it('throws when an entry is missing a label', () => {
    const path = join(dir, 'nolabel.json')
    writeFileSync(path, JSON.stringify([{ pubkey: 'a'.repeat(64) }]))
    expect(() => loadABGroups(path)).toThrow(/missing or non-string label/)
  })

  it('throws on an invalid pubkey (wrong length)', () => {
    const path = join(dir, 'badkey.json')
    writeFileSync(path, JSON.stringify([{ label: 'x', pubkey: 'abc' }]))
    expect(() => loadABGroups(path)).toThrow(/64 lowercase hex/)
  })

  it('throws on uppercase pubkey hex', () => {
    const path = join(dir, 'upper.json')
    writeFileSync(path, JSON.stringify([{ label: 'x', pubkey: 'A'.repeat(64) }]))
    expect(() => loadABGroups(path)).toThrow(/64 lowercase hex/)
  })

  it('throws when an entry is not an object', () => {
    const path = join(dir, 'str.json')
    writeFileSync(path, JSON.stringify(['a string']))
    expect(() => loadABGroups(path)).toThrow(/must be an object/)
  })
})
