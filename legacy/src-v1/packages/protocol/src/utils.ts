// Serendip Protocol — Internal utilities
// These are NOT exported from the public index — internal use only.

/**
 * Convert a Uint8Array of bytes to a lowercase hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert a hex string to a Uint8Array.
 * Throws if the input is not a valid even-length hex string.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${hex.length} (must be even)`)
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i * 2}`)
    }
    bytes[i] = byte
  }
  return bytes
}
