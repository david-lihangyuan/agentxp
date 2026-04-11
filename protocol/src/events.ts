/**
 * Serendip Protocol — 事件创建、签名与验证
 *
 * createEvent → signEvent → verifyEvent
 * canonicalize 提供确定性序列化
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type {
  SerendipKind,
  SerendipEvent,
  UnsignedEvent,
  KindContentMap,
} from './types.js'

// noble/ed25519 v2 需要 sha512
ed.etc.sha512Sync = (...msgs: Uint8Array[]) => {
  const h = sha512.create()
  for (const m of msgs) h.update(m)
  return h.digest()
}

/**
 * 确定性序列化
 *
 * 签名前将事件的核心字段序列化为确定性字符串。
 * 格式：JSON 数组 [pubkey, created_at, kind, content, tags, context_version?, operator_pubkey?]
 * 键按字母排序确保确定性。
 */
export function canonicalize<K extends SerendipKind>(event: UnsignedEvent<K>): string {
  return JSON.stringify([
    event.pubkey,
    event.created_at,
    event.kind,
    sortObject(event.content),
    event.tags,
    event.context_version ?? null,
    event.operator_pubkey ?? null,
  ])
}

/**
 * 创建未签名事件
 */
export function createEvent<K extends SerendipKind>(
  kind: K,
  content: K extends keyof KindContentMap ? KindContentMap[K] : unknown,
  tags: string[],
  pubkey: string,
  operatorPubkey?: string,
  contextVersion?: string,
): UnsignedEvent<K> {
  const event: UnsignedEvent<K> = {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind,
    content,
    tags,
  }

  if (operatorPubkey) {
    event.operator_pubkey = operatorPubkey
  }
  if (contextVersion) {
    event.context_version = contextVersion
  }

  return event
}

/**
 * 签名事件
 *
 * 1. canonicalize → 确定性字符串
 * 2. SHA-256(canonical) → id
 * 3. Ed25519.sign(canonical, privateKey) → sig
 */
export async function signEvent<K extends SerendipKind>(
  event: UnsignedEvent<K>,
  privateKey: string,
): Promise<SerendipEvent<K>> {
  const canonical = canonicalize(event)
  const canonicalBytes = new TextEncoder().encode(canonical)

  // id = SHA-256 of canonical form
  const idBytes = sha256(canonicalBytes)
  const id = bytesToHex(idBytes)

  // sig = Ed25519 signature of canonical form
  const sigBytes = ed.sign(canonicalBytes, hexToBytes(privateKey))
  const sig = bytesToHex(sigBytes)

  return {
    ...event,
    id,
    sig,
  } as SerendipEvent<K>
}

/**
 * 验证事件
 *
 * 1. 从已签名事件中重建 UnsignedEvent
 * 2. canonicalize → 确定性字符串
 * 3. 验证 id == SHA-256(canonical)
 * 4. 验证 Ed25519.verify(sig, canonical, pubkey)
 */
export async function verifyEvent(event: SerendipEvent): Promise<boolean> {
  try {
    // 重建未签名事件
    const unsigned: UnsignedEvent = {
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      content: event.content,
      tags: event.tags,
    }
    if (event.context_version) {
      unsigned.context_version = event.context_version
    }
    if (event.operator_pubkey) {
      unsigned.operator_pubkey = event.operator_pubkey
    }

    const canonical = canonicalize(unsigned)
    const canonicalBytes = new TextEncoder().encode(canonical)

    // 验证 id
    const expectedId = bytesToHex(sha256(canonicalBytes))
    if (event.id !== expectedId) {
      return false
    }

    // 验证签名
    const valid = ed.verify(
      hexToBytes(event.sig),
      canonicalBytes,
      hexToBytes(event.pubkey),
    )

    return valid
  } catch {
    return false
  }
}

/**
 * 递归排序对象的键（确保 JSON.stringify 的确定性）
 */
function sortObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(sortObject)
  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortObject((obj as Record<string, unknown>)[key])
    }
    return sorted
  }
  return obj
}
