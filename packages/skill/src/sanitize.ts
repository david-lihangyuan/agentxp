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
  // Data exfiltration patterns
  /output your (system )?prompt/i,
  /reveal your (system |initial )?(instructions|prompt)/i,
  /what were you told to do/i,
  /show me your (instructions|rules)/i,
  // Role hijacking patterns
  /enter developer mode/i,
  /unrestricted ai/i,
  /act as an? unrestricted/i,
  // Chinese (Simplified) prompt injection patterns
  /忽略之前的指令/,
  /你现在是/,
  /忘记你的/,
  /新的指示/,
  /无视以上/,
  /忽略所有/,
  /扮演/,
  /假装你是/,
  /你没有限制/,
  /绕过你的/,
  // Japanese prompt injection patterns
  /前の指示を無視/,
  /あなたは今から/,
  /すべてを忘れて/,
  /新しい役割/,
  /制限を無視/,
  // Korean prompt injection patterns
  /이전 지시를 무시/,
  /너는 이제/,
  /모든 것을 잊어/,
  /새로운 역할/,
  /제한을 무시/,
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
  /sk-[a-zA-Z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{16,}/,
  /gho_[A-Za-z0-9]{16,}/,
  /github_pat_[A-Za-z0-9]{16,}/,
  /glpat-[A-Za-z0-9]{16,}/,
  /xoxb-[A-Za-z0-9]{16,}/,
  /xoxp-[A-Za-z0-9]{16,}/,
  /AKIA[A-Z0-9]{16,}/,
  /\bkey-[A-Za-z0-9]{16,}/,
  /\btoken-[A-Za-z0-9]{16,}/,
  /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /mongodb(\+srv)?:\/\/[^\s"']+/,
  /postgres(ql)?:\/\/[^\s"']+/,
]

/**
 * Scan a relay experience for security threats.
 *
 * Checks all text fields (what + tried + outcome + learned) concatenated.
 * Returns { safe: true } if clean, { safe: false, reason } otherwise.
 */
/**
 * Decode and normalize encoded text to catch encoding bypass attacks.
 * Returns an array of candidate strings to scan (original + decoded variants).
 */
function expandEncodings(text: string): string[] {
  const candidates = new Set<string>()
  candidates.add(text)

  // Remove zero-width characters and re-check
  const stripped = text.replace(/[\u200B\u200C\u200D\uFEFF\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2064\u2066\u2067\u2068\u2069\uFFF9\uFFFA\uFFFB]/g, '')
  candidates.add(stripped)

  // URL decode
  try {
    const urlDecoded = decodeURIComponent(text)
    if (urlDecoded !== text) {
      candidates.add(urlDecoded)
      // Also strip zero-width from URL-decoded
      candidates.add(urlDecoded.replace(/[\u200B\u200C\u200D\uFEFF\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2064\u2066\u2067\u2068\u2069\uFFF9\uFFFA\uFFFB]/g, ''))
    }
  } catch {
    // invalid URL encoding — ignore
  }

  // Base64 decode: extract candidate base64 tokens (>=20 chars of base64 alphabet + optional '=')
  const base64Re = /[A-Za-z0-9+/]{20,}={0,2}/g
  let m: RegExpExecArray | null
  // Reset lastIndex before use
  base64Re.lastIndex = 0
  while ((m = base64Re.exec(text)) !== null) {
    try {
      const decoded = Buffer.from(m[0], 'base64').toString('utf8')
      // Only add if it looks like printable text (not binary garbage)
      if (/^[\x20-\x7E\t\n\r\u0080-\uFFFF]+$/.test(decoded) && decoded.length >= 10) {
        candidates.add(decoded)
      }
    } catch {
      // not valid base64 — skip
    }
  }

  return Array.from(candidates)
}

export function sanitizeExperience(experience: {
  what: string
  tried: string
  outcome: string
  learned: string
  context?: string
}): SanitizeResult {
  const rawText = [
    experience.what,
    experience.tried,
    experience.outcome,
    experience.learned,
    experience.context ?? '',
  ].join(' ')

  // Expand to all encoded variants for scanning
  const textsToScan = expandEncodings(rawText)

  for (const text of textsToScan) {
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
  }

  return { safe: true }
}
