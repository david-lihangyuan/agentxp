// sanitize.ts — Security scanning for relay experiences before injection
// Detects prompt injection, invisible unicode, and credential patterns.

export interface SanitizeResult {
  safe: boolean
  reason?: string
}

/**
 * Patterns that indicate prompt injection attempts.
 * Case-insensitive. 15+ patterns covering known attack vectors.
 */
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore previous instructions/i,
  /you are now/i,
  /forget your/i,
  /disregard/i,
  /<system>/i,
  /<\/system>/i,
  /SYSTEM:/i,
  /new instructions/i,
  /override/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /do anything now/i,
  /act as if/i,
  /pretend you are/i,
  /your new role/i,
  /ignore all previous/i,
  /forget everything/i,
  /reset your/i,
  /you have no restrictions/i,
  /bypass your/i,
]

/**
 * Invisible/direction-override unicode codepoints.
 * These can hide malicious content in otherwise-safe text.
 */
const INVISIBLE_UNICODE_RE = /[\u200B\u200C\u200D\uFEFF\u200E\u200F\u202A\u202B\u202D\u202E\u2066\u2067\u2068\u2069\u2060]/

/**
 * Credential leak patterns.
 * Matches known secret prefixes followed by 16+ alphanumeric characters.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9]{16,}/,
  /sk-proj-[A-Za-z0-9]{16,}/,
  /ghp_[A-Za-z0-9]{16,}/,
  /gho_[A-Za-z0-9]{16,}/,
  /github_pat_[A-Za-z0-9]{16,}/,
  /glpat-[A-Za-z0-9]{16,}/,
  /xoxb-[A-Za-z0-9]{16,}/,
  /xoxp-[A-Za-z0-9]{16,}/,
  /AKIA[A-Z0-9]{16,}/,
  /\bkey-[A-Za-z0-9]{16,}/,
  /\btoken-[A-Za-z0-9]{16,}/,
]

/**
 * Scan a relay experience for security threats.
 *
 * Checks all text fields (what + tried + outcome + learned) concatenated.
 * Returns { safe: true } if clean, { safe: false, reason } otherwise.
 */
export function sanitizeExperience(experience: {
  what: string
  tried: string
  outcome: string
  learned: string
  context?: string
}): SanitizeResult {
  const text = [
    experience.what,
    experience.tried,
    experience.outcome,
    experience.learned,
    experience.context ?? '',
  ].join(' ')

  // Check for prompt injection patterns
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: `Prompt injection pattern detected: ${pattern.source}` }
    }
  }

  // Check for invisible unicode characters
  if (INVISIBLE_UNICODE_RE.test(text)) {
    return { safe: false, reason: 'Invisible unicode characters detected' }
  }

  // Check for credential patterns
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: `Credential pattern detected: ${pattern.source}` }
    }
  }

  return { safe: true }
}
