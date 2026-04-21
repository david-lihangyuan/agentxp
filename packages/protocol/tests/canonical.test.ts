import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { canonicalize, sha256hex } from '../src/canonical.js'
import { bytesToHex, hexToBytes } from '../src/utils.js'
import type { SerendipEvent } from '../src/types.js'

const sampleUnsigned: Omit<SerendipEvent, 'sig' | 'id'> = {
  v: 1,
  pubkey: 'b'.repeat(64),
  created_at: 1_775_867_000,
  kind: 'intent.broadcast',
  payload: {
    type: 'experience',
    data: { what: 'x', tried: 'y', outcome: 'succeeded', learned: 'z' },
  },
  tags: ['docker', 'dns'],
  visibility: 'public',
  operator_pubkey: 'c'.repeat(64),
}

describe('canonicalize (ADR-003 D1)', () => {
  it('is deterministic for identical input shapes', () => {
    expect(canonicalize({ ...sampleUnsigned })).toBe(canonicalize(sampleUnsigned))
  })

  it('is insensitive to key insertion order', () => {
    const reordered = {
      operator_pubkey: sampleUnsigned.operator_pubkey,
      kind: sampleUnsigned.kind,
      v: sampleUnsigned.v,
      visibility: sampleUnsigned.visibility,
      tags: sampleUnsigned.tags,
      payload: sampleUnsigned.payload,
      created_at: sampleUnsigned.created_at,
      pubkey: sampleUnsigned.pubkey,
    }
    expect(canonicalize(reordered)).toBe(canonicalize(sampleUnsigned))
  })

  it('sorts nested payload keys recursively', () => {
    const a = { ...sampleUnsigned, payload: { type: 'experience', data: { a: 1, b: 2 } } }
    const b = { ...sampleUnsigned, payload: { type: 'experience', data: { b: 2, a: 1 } } }
    expect(canonicalize(a)).toBe(canonicalize(b))
  })

  it('emits no whitespace between JSON tokens', () => {
    const serialised = canonicalize(sampleUnsigned)
    expect(serialised).not.toMatch(/[\t\n\r ]/)
  })

  it('omits id and sig fields from the canonical bytes', () => {
    const full = { ...sampleUnsigned, id: 'a'.repeat(64), sig: 'd'.repeat(128) }
    expect(canonicalize(full as unknown as SerendipEvent)).toBe(canonicalize(sampleUnsigned))
  })

  it('changes when any signed field changes', () => {
    const base = canonicalize(sampleUnsigned)
    expect(canonicalize({ ...sampleUnsigned, tags: [...sampleUnsigned.tags, 'extra'] })).not.toBe(
      base,
    )
    expect(canonicalize({ ...sampleUnsigned, visibility: 'private' })).not.toBe(base)
    expect(canonicalize({ ...sampleUnsigned, created_at: sampleUnsigned.created_at + 1 })).not.toBe(
      base,
    )
  })
})

describe('sha256hex', () => {
  it('returns 64 lowercase hex characters', () => {
    const digest = sha256hex('hello')
    expect(digest).toHaveLength(64)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches node:crypto SHA-256 on UTF-8 bytes', () => {
    const input = 'Serendip Protocol v1'
    const expected = createHash('sha256').update(input, 'utf8').digest('hex')
    expect(sha256hex(input)).toBe(expected)
  })
})

describe('hex utilities', () => {
  it('round-trips arbitrary byte sequences', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x10, 0xff, 0xde, 0xad, 0xbe, 0xef])
    expect(bytesToHex(bytes)).toBe('000110ffdeadbeef')
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes)
  })

  it('throws on odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrow()
  })

  it('throws on non-hex characters', () => {
    expect(() => hexToBytes('zz')).toThrow()
  })
})
