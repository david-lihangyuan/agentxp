// Supernode AgentXP — Sanitization Engine
// Client-side: high-risk = block, medium-risk = redact, clean = pass.
// Relay-side: last-resort scan for sensitive patterns.

export type SanitizeAction = 'block' | 'redact' | 'pass'

export interface SanitizeResult {
  action: SanitizeAction
  reason?: string
  content?: Record<string, unknown>
  blocked?: boolean
}

// High-risk patterns: API keys, private keys, DB connection strings
const HIGH_RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/, reason: 'API key (OpenAI format)' },
  { pattern: /ghp_[a-zA-Z0-9]{20,}/, reason: 'API key (GitHub PAT)' },
  { pattern: /AKIA[A-Z0-9]{16}/, reason: 'API key (AWS access key)' },
  { pattern: /[a-zA-Z0-9_\-]+(API|api)_?(KEY|key)\s*=\s*\S+/, reason: 'API key assignment' },
  { pattern: /OPENAI_API_KEY\s*=\s*\S+/, reason: 'API key' },
  { pattern: /-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY|OPENSSH PRIVATE KEY)-----/, reason: 'Private key' },
  { pattern: /private key/i, reason: 'Private key reference' },
  { pattern: /mongodb\+srv:\/\/[^@]+@/, reason: 'DB connection string with credentials' },
  { pattern: /postgres(?:ql)?:\/\/[^\s"']+/, reason: 'DB connection string' },
  { pattern: /mysql:\/\/[^\s"']+/, reason: 'DB connection string' },
]

// Medium-risk patterns: private IPs, internal URLs, emails, absolute paths
const MEDIUM_RISK_PATTERNS: Array<{ pattern: RegExp; placeholder: string }> = [
  { pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/g, placeholder: '[PRIVATE_URL]' },
  { pattern: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, placeholder: '[PRIVATE_URL]' },
  { pattern: /\b172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/g, placeholder: '[PRIVATE_URL]' },
  { pattern: /http:\/\/192\.168\.[^\s"']*/g, placeholder: '[PRIVATE_URL]' },
  { pattern: /http:\/\/10\.[^\s"']*/g, placeholder: '[PRIVATE_URL]' },
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+-internal\.[a-zA-Z]{2,}\b/g, placeholder: '[REDACTED_EMAIL]' },
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, placeholder: '[REDACTED_EMAIL]' },
]

/**
 * Sanitize experience content before publishing.
 * Returns block/redact/pass with modified content for redactions.
 */
export function sanitize(content: Record<string, unknown>): SanitizeResult {
  const text = JSON.stringify(content)

  // Check high-risk patterns first
  for (const { pattern, reason } of HIGH_RISK_PATTERNS) {
    if (pattern.test(text)) {
      return { action: 'block', reason }
    }
  }

  // Check medium-risk patterns — redact if found
  let modified = text
  let didRedact = false

  for (const { pattern, placeholder } of MEDIUM_RISK_PATTERNS) {
    const next = modified.replace(pattern, placeholder)
    if (next !== modified) {
      modified = next
      didRedact = true
    }
  }

  if (didRedact) {
    try {
      const redactedContent = JSON.parse(modified) as Record<string, unknown>
      return { action: 'redact', content: redactedContent }
    } catch {
      return { action: 'block', reason: 'failed to parse after redaction' }
    }
  }

  return { action: 'pass', content }
}

/**
 * Relay-side last-resort sanitization scan.
 * Called on raw incoming events before storage.
 */
export function relaySanitize(event: unknown): { blocked: boolean; reason?: string } {
  const text = JSON.stringify(event)

  for (const { pattern, reason } of HIGH_RISK_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason }
    }
  }

  return { blocked: false }
}
