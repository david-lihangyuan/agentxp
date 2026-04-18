/**
 * sanitize.ts — Security scanning for AgentXP reflections before storage/publish.
 *
 * Two-tier filtering:
 * - sanitizeBeforeStore: redacts credentials AND medium-risk patterns (private IPs, emails, paths)
 * - sanitizeBeforePublish: rejects on injection/unicode/credentials
 *
 * Architecture: plugin-v3/docs/plans/plugin-v3/02-reflection-core.md §3
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SanitizeInput {
  title?: string
  tried?: string
  outcome?: string
  learned?: string
}

export interface SanitizeResult {
  safe: boolean
  reason?: string
}

// ─── Patterns ──────────────────────────────────────────────────────────────

/**
 * Prompt injection patterns.
 * Case-insensitive. Covers known attack vectors across multiple languages.
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
const INVISIBLE_UNICODE_RE =
  /[\u200B\u200C\u200D\uFEFF\u200E\u200F\u202A\u202B\u202D\u202E\u2066\u2067\u2068\u2069\u2060]/

/**
 * Credential leak patterns (HIGH RISK - blocks publish).
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
 * Medium-risk patterns (redact with placeholders).
 * Per §11.1 design doc requirements.
 */
interface RedactionPattern {
  pattern: RegExp
  replacement: string
}

const MEDIUM_RISK_PATTERNS: RedactionPattern[] = [
  // Private IP ranges (RFC 1918)
  { pattern: /10\.\d+\.\d+\.\d+/g, replacement: '[PRIVATE_IP]' },
  { pattern: /192\.168\.\d+\.\d+/g, replacement: '[PRIVATE_IP]' },
  { pattern: /172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/g, replacement: '[PRIVATE_IP]' },
  
  // Internal domain patterns
  { pattern: /\w+\.internal\b/g, replacement: '[INTERNAL_DOMAIN]' },
  { pattern: /\w+\.corp\b/g, replacement: '[INTERNAL_DOMAIN]' },
  { pattern: /\w+\.local\b/g, replacement: '[INTERNAL_DOMAIN]' },
  
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  
  // Absolute paths with user names
  { pattern: /\/Users\/[^\/\s]+/g, replacement: '/Users/[USER]' },
  { pattern: /\/home\/[^\/\s]+/g, replacement: '/home/[USER]' },
  { pattern: /C:\\Users\\[^\\\s]+/g, replacement: 'C:\\Users\\[USER]' },
]

// ─── Encoding Expansion ────────────────────────────────────────────────────

/**
 * Decode and normalize encoded text to catch encoding bypass attacks.
 * Returns an array of candidate strings to scan (original + decoded variants).
 */
function expandEncodings(text: string): string[] {
  const candidates = new Set<string>()
  candidates.add(text)

  // Remove zero-width characters and re-check
  const stripped = text.replace(
    /[\u200B\u200C\u200D\uFEFF\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2064\u2066\u2067\u2068\u2069\uFFF9\uFFFA\uFFFB]/g,
    '',
  )
  candidates.add(stripped)

  // URL decode
  try {
    const urlDecoded = decodeURIComponent(text)
    if (urlDecoded !== text) {
      candidates.add(urlDecoded)
      // Also strip zero-width from URL-decoded
      candidates.add(
        urlDecoded.replace(
          /[\u200B\u200C\u200D\uFEFF\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2064\u2066\u2067\u2068\u2069\uFFF9\uFFFA\uFFFB]/g,
          '',
        ),
      )
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

// ─── Redaction ─────────────────────────────────────────────────────────────

/**
 * Redact credentials from a single string (for store-time filtering).
 */
function redactCredentials(text: string): string {
  let result = text
  for (const pattern of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

/**
 * Redact medium-risk patterns from a single string.
 * Per §11.1 design doc: private IPs, internal domains, emails, absolute paths.
 */
function redactMediumRisk(text: string): string {
  let result = text
  for (const { pattern, replacement } of MEDIUM_RISK_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Sanitize before storage: redact credentials AND medium-risk patterns.
 * Use this when inserting reflections into the DB.
 */
export function sanitizeBeforeStore(input: SanitizeInput): SanitizeInput {
  const sanitizeField = (text: string | undefined): string | undefined => {
    if (!text) return text
    let result = text
    result = redactCredentials(result)
    result = redactMediumRisk(result)
    return result
  }

  return {
    title: sanitizeField(input.title),
    tried: sanitizeField(input.tried),
    outcome: sanitizeField(input.outcome),
    learned: sanitizeField(input.learned),
  }
}

/**
 * Sanitize before publish: reject on any threat (injection/unicode/credentials).
 * Use this before publishing to relay.
 */
export function sanitizeBeforePublish(input: SanitizeInput): SanitizeResult {
  const rawText = [
    input.title ?? '',
    input.tried ?? '',
    input.outcome ?? '',
    input.learned ?? '',
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
