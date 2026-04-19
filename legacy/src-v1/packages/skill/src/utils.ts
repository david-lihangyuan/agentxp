// Skill package utilities

/**
 * Convert a Uint8Array of bytes to a lowercase hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Estimate token count for a string.
 * Uses the common ~4 characters per token heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
