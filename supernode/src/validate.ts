// Supernode — Input Validation Layer
// Tags: [a-zA-Z0-9-_.] only
// Timestamps: digits only, range-checked
// Pubkeys: 64-char hex only
// Payload size: 64KB max

/** Tag validation: [a-zA-Z0-9-_.] only */
const TAG_PATTERN = /^[a-zA-Z0-9\-_.]+$/

/** Pubkey validation: exactly 64 hex characters */
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/

/** Max payload size: 64KB */
export const MAX_PAYLOAD_BYTES = 64 * 1024

/** Prompt injection patterns to reject */
const INJECTION_PATTERNS = [
  'ignore previous instructions',
  'you are now',
  'system:',
  '<|im_start|>',
]

export interface ValidationResult {
  valid: boolean
  error?: string
}

/** Validate a single tag string. */
export function validateTag(tag: string): ValidationResult {
  if (!TAG_PATTERN.test(tag)) {
    return {
      valid: false,
      error: `Invalid tag "${tag}": only [a-zA-Z0-9-_.] characters allowed`,
    }
  }
  return { valid: true }
}

/** Validate an array of tags. */
export function validateTags(tags: unknown): ValidationResult {
  if (!Array.isArray(tags)) {
    return { valid: false, error: 'tags must be an array' }
  }
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      return { valid: false, error: 'each tag must be a string' }
    }
    const result = validateTag(tag)
    if (!result.valid) return result
  }
  return { valid: true }
}

/** Validate a Unix timestamp (digits only, reasonable range). */
export function validateTimestamp(ts: unknown): ValidationResult {
  if (typeof ts !== 'number' || !Number.isInteger(ts)) {
    return { valid: false, error: 'timestamp must be an integer' }
  }
  if (ts < 0) {
    return { valid: false, error: 'timestamp must be non-negative' }
  }
  // Sanity check: within year 2000-2100
  const min = 946684800 // 2000-01-01
  const max = 4102444800 // 2100-01-01
  if (ts < min || ts > max) {
    return { valid: false, error: `timestamp ${ts} out of valid range` }
  }
  return { valid: true }
}

/** Validate a public key (64-char hex). */
export function validatePubkey(pubkey: unknown): ValidationResult {
  if (typeof pubkey !== 'string') {
    return { valid: false, error: 'pubkey must be a string' }
  }
  if (!PUBKEY_PATTERN.test(pubkey)) {
    return { valid: false, error: 'pubkey must be 64 lowercase hex characters' }
  }
  return { valid: true }
}

/** Check payload size does not exceed 64KB. */
export function validatePayloadSize(payload: unknown): ValidationResult {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const bytes = new TextEncoder().encode(str).length
  if (bytes > MAX_PAYLOAD_BYTES) {
    return {
      valid: false,
      error: `payload too large: ${bytes} bytes (max ${MAX_PAYLOAD_BYTES})`,
    }
  }
  return { valid: true }
}

/** Scan text fields for prompt injection patterns. */
export function scanForPromptInjection(obj: unknown): ValidationResult {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj)
  const lower = text.toLowerCase()
  for (const pattern of INJECTION_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return {
        valid: false,
        error: `prompt injection pattern detected: "${pattern}"`,
      }
    }
  }
  return { valid: true }
}

/** Validate query string tags parameter. */
export function validateQueryTags(tagsParam: string | null): ValidationResult {
  if (!tagsParam) return { valid: true }
  const tags = tagsParam.split(',').map((t) => t.trim()).filter(Boolean)
  return validateTags(tags)
}
