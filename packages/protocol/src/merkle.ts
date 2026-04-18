// Serendip Protocol — Merkle Hash Integrity
// Standard binary Merkle tree over event ids.
// Used for cross-verifying relay data against local sovereign copies.
import { sha256 } from '@noble/hashes/sha256'
import type { SerendipEvent } from './types.js'
import { bytesToHex, hexToBytes } from './utils.js'

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

/** Hash a leaf: sha256(eventId as bytes). */
function hashLeaf(eventId: string): string {
  const bytes = new TextEncoder().encode(eventId)
  return bytesToHex(sha256(bytes))
}

/** Hash an internal node: sha256(leftBytes || rightBytes). */
function hashNode(left: string, right: string): string {
  const leftBytes = hexToBytes(left)
  const rightBytes = hexToBytes(right)
  const combined = new Uint8Array(leftBytes.length + rightBytes.length)
  combined.set(leftBytes, 0)
  combined.set(rightBytes, leftBytes.length)
  return bytesToHex(sha256(combined))
}

/**
 * Build a complete Merkle tree and return all levels.
 * Level 0 = leaves, level[last] = root (single element).
 * Odd-count levels duplicate the last node.
 */
function buildTree(leafHashes: string[]): string[][] {
  if (leafHashes.length === 0) {
    throw new Error('Cannot build Merkle tree from empty event list')
  }

  const levels: string[][] = [leafHashes]
  let currentLevel = leafHashes

  while (currentLevel.length > 1) {
    const nextLevel: string[] = []
    // Pad odd-length levels by duplicating the last leaf
    const paddedLevel =
      currentLevel.length % 2 === 0
        ? currentLevel
        : [...currentLevel, currentLevel[currentLevel.length - 1]]

    for (let i = 0; i < paddedLevel.length; i += 2) {
      nextLevel.push(hashNode(paddedLevel[i], paddedLevel[i + 1]))
    }
    levels.push(nextLevel)
    currentLevel = nextLevel
  }

  return levels
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Build a Merkle root over a set of events.
 * Tree structure:
 *   - Leaf = sha256(event.id as UTF-8 string)
 *   - Internal node = sha256(leftHash || rightHash)
 *   - Odd number of leaves: duplicate last leaf before hashing
 *
 * @param events - Array of signed SerendipEvents (order matters)
 * @returns SHA-256 Merkle root as hex string (64 chars)
 */
export function buildMerkleRoot(events: SerendipEvent[]): string {
  const leaves = events.map((e) => hashLeaf(e.id))
  const levels = buildTree(leaves)
  return levels[levels.length - 1][0]
}

/**
 * Get the Merkle proof (sibling hashes) for an event at a given position.
 * The proof allows reconstructing the root from just the event id + proof path.
 *
 * @param events - The full set of events used to build the tree
 * @param eventId - The id of the event to prove inclusion for
 * @returns Array of sibling hashes (proof path), or null if event not found
 */
export function getMerkleProof(
  events: SerendipEvent[],
  eventId: string
): string[] | null {
  const leafIndex = events.findIndex((e) => e.id === eventId)
  if (leafIndex === -1) {
    return null
  }

  const leaves = events.map((e) => hashLeaf(e.id))
  const levels = buildTree(leaves)
  const proof: string[] = []

  let index = leafIndex
  for (let level = 0; level < levels.length - 1; level++) {
    const currentLevel = levels[level]
    // Pad odd-length levels (same logic as buildTree)
    const paddedLevel =
      currentLevel.length % 2 === 0
        ? currentLevel
        : [...currentLevel, currentLevel[currentLevel.length - 1]]

    const isRightNode = index % 2 === 1
    const siblingIndex = isRightNode ? index - 1 : index + 1

    // Encode direction: 'L' means sibling is on the LEFT (current is right),
    // 'R' means sibling is on the RIGHT (current is left).
    const direction = isRightNode ? 'L' : 'R'
    proof.push(direction + paddedLevel[siblingIndex])
    index = Math.floor(index / 2)
  }

  return proof
}

/**
 * Verify a Merkle proof for an event.
 * Reconstructs the root from eventId + proof and compares against the expected root.
 *
 * @param eventId - The event id to verify
 * @param proof - Sibling hash array returned by getMerkleProof
 * @param root - Expected Merkle root hex string
 * @returns true if the proof is valid, false otherwise
 */
export function verifyMerkleProof(
  eventId: string,
  proof: string[],
  root: string
): boolean {
  try {
    let current = hashLeaf(eventId)

    for (const sibling of proof) {
      // Each proof entry is direction-prefixed: 'L<hash>' or 'R<hash>'.
      // 'L' = sibling is on the left, current goes on the right.
      // 'R' = sibling is on the right, current stays on the left.
      const direction = sibling[0] // 'L' or 'R'
      const hash = sibling.slice(1)

      if (direction === 'L') {
        current = hashNode(hash, current)
      } else {
        current = hashNode(current, hash)
      }
    }

    return current === root
  } catch {
    return false
  }
}
