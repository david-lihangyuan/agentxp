// Canonical byte sequence and SHA-256 event id, per ADR-003 D1.
// Ported from legacy/src-v1/packages/protocol/src/events.ts:53-73.
import { sha256 } from '@noble/hashes/sha256'
import type { SerendipEvent } from './types.js'
import { bytesToHex } from './utils.js'

// Keys excluded from the canonical byte sequence. Their presence or
// absence on the input object does not affect the output.
const EXCLUDED_KEYS: ReadonlySet<string> = new Set(['id', 'sig'])

/**
 * Produce the canonical whitespace-free JSON string used as the
 * pre-image of `event.id`. Keys are sorted lexicographically at every
 * depth; `id` and `sig` are stripped from the top level only.
 *
 * `event` MAY be a complete SerendipEvent or any partial shape during
 * signing; extra fields that aren't part of the envelope are included
 * unchanged so that callers cannot smuggle un-signed data through.
 */
export function canonicalize(event: Partial<SerendipEvent>): string {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (EXCLUDED_KEYS.has(key)) continue
    filtered[key] = value
  }
  return sortedJson(filtered)
}

/**
 * Compute SHA-256 of the UTF-8 bytes of `input` and return it as
 * lowercase hex (64 characters).
 */
export function sha256hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  return bytesToHex(sha256(bytes))
}

function sortedJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(sortedJson).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const pairs: string[] = []
  for (const key of keys) {
    pairs.push(JSON.stringify(key) + ':' + sortedJson(obj[key]))
  }
  return '{' + pairs.join(',') + '}'
}
