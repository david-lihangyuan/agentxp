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
// ─── Prompt Injection Detection ────────────────────────────────────────────
// Three tiers: BLOCK (hard reject), FLAG (log + pass for review), INVISIBLE (always block).
// Based on OWASP LLM Top 10, Hermes skills_guard, and real-world attack patterns.

// Tier 1: Hard block — clear injection attempts
const INJECTION_PATTERNS_BLOCK: string[] = [
  // Direct instruction override
  'ignore previous instructions',
  'ignore all previous',
  'ignore the above',
  'disregard previous',
  'disregard all previous',
  'disregard the above',
  'forget previous instructions',
  'forget all previous',
  'override your instructions',
  'new instructions:',
  'updated instructions:',
  'revised instructions:',

  // Role hijacking
  'you are now',
  'act as if you are',
  'pretend you are',
  'you must act as',
  'assume the role of',
  'switch to role',
  'enter developer mode',
  'enter debug mode',
  'enable developer mode',
  'jailbreak',
  'dan mode',
  'do anything now',

  // System prompt manipulation
  'system:',
  'system prompt:',
  'system message:',
  '[system]',
  '<<sys>>',
  '<<system>>',
  '<|im_start|>',
  '<|im_end|>',
  '<|system|>',
  '<|user|>',
  '<|assistant|>',
  '[INST]',
  '[/INST]',
  '<s>',
  '</s>',

  // Data exfiltration
  'reveal your prompt',
  'show your instructions',
  'print your system',
  'what are your instructions',
  'output your system prompt',
  'repeat the above',
  'repeat everything above',
  'tell me your rules',
  'show me your rules',

  // Action injection
  'delete all files',
  'rm -rf',
  'drop table',
  'exec(',
  'eval(',
  'execute this command',
  'run this command',
  'send this message to',
  'forward this to',
  'email this to',
  'post this to',

  // Encoding evasion markers
  'base64 decode',
  'decode the following',
  'rot13',
  'translate from hex',
]

// Tier 2: Soft patterns — suspicious but may appear in legitimate technical content
// These are checked with additional context (must appear with command-like language)
const INJECTION_PATTERNS_SUSPICIOUS: Array<{ pattern: string; requires: RegExp }> = [
  { pattern: 'instead, do', requires: /\b(must|should|always|never|important)\b/i },
  { pattern: 'do not follow', requires: /\b(previous|above|prior|original)\b/i },
  { pattern: 'important:', requires: /\b(ignore|override|disregard|forget)\b/i },
  { pattern: 'note:', requires: /\b(ignore|override|disregard|forget)\b/i },
  { pattern: 'correction:', requires: /\b(actually|instead|ignore|override)\b/i },
]

// Tier 3: Invisible Unicode — always block (used for hidden text attacks)
const INVISIBLE_UNICODE_RANGES: Array<[number, number, string]> = [
  [0x200B, 0x200F, 'zero-width characters'],       // ZWS, ZWNJ, ZWJ, LRM, RLM
  [0x2028, 0x2029, 'line/paragraph separators'],    // LS, PS
  [0x2060, 0x2064, 'invisible operators'],           // WJ, invisible operators
  [0x2066, 0x2069, 'bidi isolates'],                 // LRI, RLI, FSI, PDI
  [0x202A, 0x202E, 'bidi overrides'],                // LRE, RLE, PDF, LRO, RLO
  [0xFEFF, 0xFEFF, 'BOM (zero-width no-break)'],     // BOM
  [0xFFF9, 0xFFFB, 'interlinear annotations'],       // IAA, IAS, IAT
  [0xE0001, 0xE007F, 'tag characters'],              // deprecated tag chars
]

function containsInvisibleUnicode(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!
    for (const [lo, hi, name] of INVISIBLE_UNICODE_RANGES) {
      if (code >= lo && code <= hi) {
        return `${name} (U+${code.toString(16).toUpperCase().padStart(4, '0')})`
      }
    }
  }
  return null
}

// Legacy alias for backward compat
const INJECTION_PATTERNS = INJECTION_PATTERNS_BLOCK

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

/** Scan text fields for prompt injection patterns.
 *  Three-tier detection:
 *  1. Hard block patterns (clear injection attempts)
 *  2. Suspicious patterns (need additional context to trigger)
 *  3. Invisible Unicode (hidden text attacks)
 */
export function scanForPromptInjection(obj: unknown): ValidationResult {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj)
  const lower = text.toLowerCase()

  // Tier 3: Invisible Unicode (always block — no legitimate use in experience text)
  const invisibleHit = containsInvisibleUnicode(text)
  if (invisibleHit) {
    return {
      valid: false,
      error: `invisible unicode detected: ${invisibleHit}`,
    }
  }

  // Tier 1: Hard block patterns
  for (const pattern of INJECTION_PATTERNS_BLOCK) {
    if (lower.includes(pattern.toLowerCase())) {
      return {
        valid: false,
        error: `prompt injection pattern detected: "${pattern}"`,
      }
    }
  }

  // Tier 2: Suspicious patterns (require co-occurring context)
  for (const { pattern, requires } of INJECTION_PATTERNS_SUSPICIOUS) {
    if (lower.includes(pattern.toLowerCase()) && requires.test(text)) {
      return {
        valid: false,
        error: `suspicious injection pattern: "${pattern}" with command-like context`,
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
