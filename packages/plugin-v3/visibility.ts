/**
 * visibility.ts — Auto-classify reflection visibility (§11.2 + §11.3).
 *
 * Pure function — no DB dependency. Safe default: uncertain → 'private'.
 * Architecture: plugin-v3/docs/plans/plugin-v3/02-reflection-core.md §5
 *
 * Tech stack: TypeScript ESM, strict mode, no external dependencies.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Visibility = 'public' | 'private'

export interface VisibilityInput {
  title: string
  tried?: string
  learned?: string
  tags?: string[]
}

export interface VisibilityConfig {
  operatorOverride?: 'public' | 'private'
}

// ─── Private indicators ───────────────────────────────────────────────────────

/**
 * Keyword patterns that indicate content is company/context-specific and
 * should not be published to the network.
 */
const PRIVATE_KEYWORD_RE =
  /\b(internal|company|private|proprietary|staging|production|corp|confidential|secret|vpn|intranet|employee|payroll|salary|customer|client)\b/i

/**
 * URL patterns that indicate internal/private endpoints.
 * Matches: internal.*, *.corp.*, *.internal, *.local, *.staging.*, private IPs
 */
const PRIVATE_URL_RE =
  /https?:\/\/(?:(?:[\w-]+\.)?(?:internal|corp|intranet|staging|private|local)\.[\w.-]+|(?:10|172|192)\.\d+\.\d+\.\d+)/i

/**
 * Generic technical terms that are clearly public domain.
 * If the text ONLY contains these kinds of terms, it's safe to publish.
 */
const PUBLIC_TECH_RE =
  /\b(docker|nginx|kubernetes|postgres|mysql|redis|npm|git|github|linux|ubuntu|debian|nodejs|python|rust|golang|typescript|javascript|react|vue|webpack|vite|dns|http|https|tcp|ssh|ssl|tls|jwt|oauth|json|yaml|toml|bash|zsh|shell|cron|systemctl|apt|brew|pip)\b/i

// ─── classifyVisibility ───────────────────────────────────────────────────────

/**
 * Classify whether a reflection should be 'public' or 'private'.
 *
 * Three-layer priority (§11.2):
 * 1. Operator override → use it directly
 * 2. Private indicators in any field → 'private'
 * 3. Clearly generic technical content → 'public'
 * 4. Uncertain → 'private' (safe default per §11.3)
 */
export function classifyVisibility(
  input: VisibilityInput,
  config?: VisibilityConfig,
): Visibility {
  // 1. Operator override
  if (config?.operatorOverride) {
    return config.operatorOverride
  }

  // Combine all text fields for analysis
  const allText = [
    input.title,
    input.tried ?? '',
    input.learned ?? '',
    ...(input.tags ?? []),
  ].join(' ')

  // 2. Private indicators
  if (PRIVATE_KEYWORD_RE.test(allText)) return 'private'
  if (PRIVATE_URL_RE.test(allText)) return 'private'

  // 3. Clearly generic technical content
  // Heuristic: if we find multiple public tech terms and no private signals,
  // classify as public. Require at least 2 distinct tech terms for confidence.
  const techMatches = allText.match(new RegExp(PUBLIC_TECH_RE.source, 'gi'))
  const uniqueTechTerms = new Set((techMatches ?? []).map(t => t.toLowerCase()))
  if (uniqueTechTerms.size >= 2) return 'public'

  // 4. Uncertain → safe default
  return 'private'
}
