/**
 * Serendip Protocol — Merkle Hash 完整性校验
 *
 * 用于验证一组经验的完整性：
 * - buildMerkleRoot: 构建 Merkle tree，返回 root hash
 * - getMerkleProof: 获取某个事件的包含证明
 * - verifyMerkleProof: 验证包含证明
 */

import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import type { MerkleProof } from './types.js'

/**
 * 对一个字符串计算 SHA-256 hash（hex 输出）
 */
function hashLeaf(data: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(data)))
}

/**
 * 将两个 hash 合并后再 hash
 */
function hashPair(left: string, right: string): string {
  return hashLeaf(left + right)
}

/**
 * 构建 Merkle tree，返回所有层级的节点（用于生成证明）
 *
 * 返回二维数组：levels[0] = 叶子层, levels[last] = [root]
 */
function buildTree(eventIds: string[]): string[][] {
  if (eventIds.length === 0) {
    throw new Error('Cannot build Merkle tree from empty array')
  }

  // 叶子层：每个 event id 做一次 hash
  let currentLevel = eventIds.map(id => hashLeaf(id))
  const levels: string[][] = [currentLevel]

  while (currentLevel.length > 1) {
    const nextLevel: string[] = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]))
      } else {
        // 奇数个节点：最后一个自己和自己配对
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i]))
      }
    }
    currentLevel = nextLevel
    levels.push(currentLevel)
  }

  return levels
}

/**
 * 构建 Merkle tree，返回 root hash
 */
export function buildMerkleRoot(eventIds: string[]): string {
  const levels = buildTree(eventIds)
  return levels[levels.length - 1][0]
}

/**
 * 获取某个事件的 Merkle 包含证明
 */
export function getMerkleProof(eventIds: string[], eventId: string): MerkleProof {
  const idx = eventIds.indexOf(eventId)
  if (idx === -1) {
    throw new Error(`Event ${eventId} not found in event list`)
  }

  const levels = buildTree(eventIds)
  const root = levels[levels.length - 1][0]
  const path: MerkleProof['path'] = []

  let currentIdx = idx

  for (let level = 0; level < levels.length - 1; level++) {
    const currentLevel = levels[level]
    const isLeft = currentIdx % 2 === 0
    const siblingIdx = isLeft ? currentIdx + 1 : currentIdx - 1

    if (siblingIdx < currentLevel.length) {
      path.push({
        hash: currentLevel[siblingIdx],
        position: isLeft ? 'right' : 'left',
      })
    } else {
      // 奇数个节点，最后一个和自己配对
      path.push({
        hash: currentLevel[currentIdx],
        position: 'right',
      })
    }

    // 在下一层的索引
    currentIdx = Math.floor(currentIdx / 2)
  }

  return {
    leaf: eventId,
    path,
    root,
  }
}

/**
 * 验证 Merkle 包含证明
 */
export function verifyMerkleProof(
  eventId: string,
  proof: MerkleProof,
  expectedRoot: string,
): boolean {
  try {
    let currentHash = hashLeaf(eventId)

    for (const step of proof.path) {
      if (step.position === 'left') {
        // sibling 在左边
        currentHash = hashPair(step.hash, currentHash)
      } else {
        // sibling 在右边
        currentHash = hashPair(currentHash, step.hash)
      }
    }

    return currentHash === expectedRoot
  } catch {
    return false
  }
}
