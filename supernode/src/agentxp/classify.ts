// Supernode AgentXP — Auto-Classification
// Rule-based visibility classification: public / private / uncertain.
// 0 tokens — no LLM calls.

export type VisibilityClass = 'public' | 'private' | 'uncertain'

export interface ClassifyInput {
  tried?: string
  learned?: string
  what?: string
  tags?: string[]
}

// Keywords that indicate internal/private content
const PRIVATE_KEYWORDS = [
  'internal',
  'private',
  'company',
  'proprietary',
  'confidential',
  'intranet',
  'salesforce',
  'corp',
  'enterprise',
  'internal-api',
  'internal.com',
  'localhost',
]

// Generic technical patterns that indicate public-safe content
const PUBLIC_INDICATORS = [
  /docker/i,
  /kubernetes/i,
  /nginx/i,
  /postgres/i,
  /node\.js/i,
  /python/i,
  /typescript/i,
  /linux/i,
  /macos/i,
  /git/i,
  /npm/i,
]

/**
 * Classify experience visibility from content rules.
 * Returns 'private' as the safe default when uncertain.
 */
export function classify(input: ClassifyInput): VisibilityClass {
  const text = [input.tried, input.learned, input.what, ...(input.tags ?? [])].join(' ').toLowerCase()

  // Private keywords → private
  for (const keyword of PRIVATE_KEYWORDS) {
    if (text.includes(keyword)) {
      return 'private'
    }
  }

  // Clear public indicators → public
  let publicScore = 0
  for (const pattern of PUBLIC_INDICATORS) {
    if (pattern.test(text)) {
      publicScore++
    }
  }

  if (publicScore >= 1) {
    return 'public'
  }

  // Safe default: private when uncertain
  return 'private'
}
