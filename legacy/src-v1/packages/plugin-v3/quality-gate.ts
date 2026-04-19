/**
 * quality-gate.ts — 0-token rule-based quality assessment for reflections (§5.5).
 *
 * All logic is pure / deterministic — no LLM calls, no DB dependency.
 * Architecture: plugin-v3/docs/plans/plugin-v3/02-reflection-core.md §2
 *
 * Tech stack: TypeScript ESM, strict mode, no external dependencies.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QualityInput {
  tried?: string
  learned?: string
  tags?: string[]
}

export interface QualityResult {
  publishable: boolean
  score: number                              // 0–1
  reasons: string[]                          // failure reason codes
  suggestedCategory?: 'feeling' | 'thought' // hint for re-classification
}

// ─── Specifics detection ─────────────────────────────────────────────────────

const SPECIFICS_PATTERNS: RegExp[] = [
  // File paths: /etc/docker/daemon.json, C:\path\file.ext, relative paths like ./foo/bar.ts
  /[/\\][\w.-]+\.\w+/,
  // Backtick commands: `docker compose up`
  /`[\w-]+`/,
  // ALL_CAPS error codes: ECONNREFUSED, ENOMEM, ETIMEDOUT
  /\b[A-Z_]{3,}\b/,
  // Port/version numbers: port 5432, version 18
  /\b(?:port|version)\s*\d+/i,
  // CLI flags: --build, --no-cache, -v
  /\s--?[\w-]+/,
  // Config keys with colons (JSON/YAML-style): dns: ["8.8.8.8"]
  /\b\w+\s*:\s*[\[{"'\d]/,
  // IP addresses
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  // Commands with spaces (common CLI tools): docker compose, npm install, systemctl restart
  /\b(?:docker|npm|yarn|git|kubectl|systemctl|apt|brew|pip)\s+\w+/i,
]

function hasSpecifics(text: string): boolean {
  return SPECIFICS_PATTERNS.some(re => re.test(text))
}

// ─── Feeling detection ────────────────────────────────────────────────────────

const FEELING_RE = /\b(felt|frustrated|excited|overwhelmed|anxious|proud|sad|happy|angry|worried|tired|exhausted|confused)\b/i
const TECHNICAL_RE = /\b(error|config|file|path|command|port|dns|db|api|server|service|docker|npm|git|code|function|test|deploy|install|build|run|restart|update|fix|debug)\b/i

function isPureFeeling(learned: string): boolean {
  if (!FEELING_RE.test(learned)) return false
  // If there's also technical content, it's not purely a feeling
  if (TECHNICAL_RE.test(learned)) return false
  return true
}

// ─── assessQuality ────────────────────────────────────────────────────────────

/**
 * Assess the quality of a reflection for publishability.
 *
 * Scoring (cumulative, capped at 1.0):
 *   +0.2  tried length > 20 chars
 *   +0.2  learned length > 20 chars
 *   +0.3  contains specifics
 *   +0.1  has any tags
 *   +0.1  tags count > 2
 *   (max: 0.9 — a perfect score requires all five)
 *
 * publishable = score >= 0.5 AND no 'tried_too_short' AND no 'learned_too_short'
 */
export function assessQuality(input: QualityInput): QualityResult {
  const tried   = input.tried   ?? ''
  const learned = input.learned ?? ''
  const tags    = input.tags    ?? []

  let score = 0
  const reasons: string[] = []
  let suggestedCategory: QualityResult['suggestedCategory']

  // Rule: tried length
  if (tried.length > 20) {
    score += 0.2
  } else {
    reasons.push('tried_too_short')
  }

  // Rule: learned length
  if (learned.length > 20) {
    score += 0.2
  } else {
    reasons.push('learned_too_short')
  }

  // Rule: specifics detection (check combined text)
  const combined = `${tried} ${learned}`
  if (hasSpecifics(combined)) {
    score += 0.3
  } else {
    reasons.push('no_specifics')
  }

  // Rule: has tags
  if (tags.length > 0) {
    score += 0.1
  }

  // Rule: tags count > 2
  if (tags.length > 2) {
    score += 0.1
  }

  // Pure feeling detection (overrides publishability)
  if (isPureFeeling(learned)) {
    suggestedCategory = 'feeling'
  }

  // Cap score at 1.0
  score = Math.min(1, Math.round(score * 100) / 100)

  const publishable =
    score >= 0.5 &&
    !reasons.includes('tried_too_short') &&
    !reasons.includes('learned_too_short') &&
    suggestedCategory !== 'feeling'

  return {
    publishable,
    score,
    reasons,
    ...(suggestedCategory ? { suggestedCategory } : {}),
  }
}
