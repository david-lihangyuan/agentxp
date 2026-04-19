// trace-sanitize.ts — L2 Trace Security Layer
// Specialized sanitization for reasoning trace data (more sensitive than conclusions).

import { relaySanitize } from './sanitize.js'

// ====== #1 路径+日志脱敏 ======

/**
 * Sanitize context text: redact absolute paths, IPs, hostnames, and version numbers.
 */
export function sanitizeContext(text: string): string {
  let result = text

  // Absolute paths → relative paths
  // Match /Users/xxx/... or /home/xxx/... or /root/... etc.
  // Preserve the portion after the second path segment (the project/meaningful part)
  result = result.replace(
    /(?:\/(?:Users|home|root|var\/home)\/[^/\s"']+)(\/[^\s"']*)/g,
    '$1'
  )
  // Also strip leading / from remaining absolute paths (e.g., /etc/foo, /tmp/bar)
  // only if they look like file paths (contain at least one more segment)
  result = result.replace(
    /(?<![a-zA-Z:])\/(?:etc|tmp|opt|srv|app|workspace|usr|var|proc|sys)(?:\/[^\s"']*)/g,
    (match) => match.slice(1) // strip leading slash
  )

  // Combined IP + version substitution in a single pass to avoid ordering conflicts.
  // Pattern: X.Y.Z or X.Y.Z.W
  //   - If preceded by a version keyword (version/ver/release/v) → treat as version → X.x
  //   - If 4 parts → IPv4 address → [REDACTED_IP]
  //   - If 3 parts → version number → X.x
  result = result.replace(
    /((?:version|ver|release)\s+|\bv)(\d+(?:\.\d+){2,3})\b|(\d+(?:\.\d+){2,3})\b/gi,
    (match, vprefix, vnum, standalone) => {
      if (vprefix && vnum) {
        // Explicit version context → always treat as version
        const major = vnum.split('.')[0]
        return `${vprefix}${major}.x`
      }
      // Standalone: decide by segment count
      const parts = standalone.split('.')
      if (parts.length === 4) {
        // 4-part → IPv4 address
        return '[REDACTED_IP]'
      }
      // 3-part → version number
      return `${parts[0]}.x`
    }
  )

  // user@hostname → [REDACTED_HOST]
  result = result.replace(
    /\b[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\b/g,
    '[REDACTED_HOST]'
  )

  return result
}

// ====== #3 attack-chain 检测 ======

const ATTACK_KEYWORDS = {
  vulnerability: /vulnerabilit(?:y|ies)|weakness|flaw|exploit|CVE-\d/i,
  bypass: /bypass|circumvent|evade|escalat(?:e|ion)|privilege|unauthorized/i,
  success: /success(?:ful(?:ly)?)?|worked|confirmed|achieved|exploited|gained access/i,
  authSecurity: /auth(?:entication|orization)?|security|permission|access control|credential|token|password/i,
  observe: /observ(?:e|ed|ing)|found|discover(?:ed)?|identif(?:y|ied)|detect(?:ed)?/i,
  investigate: /investigat(?:e|ed|ing)|analyz(?:e|ed|ing)|examin(?:e|ed|ing)|test(?:ed|ing)?|prob(?:e|ed|ing)/i,
  injection: /injection|sql\s+inject|xss|command\s+inject|ldap\s+inject/i,
  verify: /verif(?:y|ied|ication)|confirm(?:ed)?|validated?|proven?/i,
}

const DANGEROUS_TERMS = ['bypass', 'exploit', 'privilege escalation', 'injection']
const SUCCESS_TERMS = ['success', 'worked', 'confirmed']

/**
 * Detect attack-chain patterns in a sequence of reasoning steps.
 */
export function detectAttackChain(
  steps: Array<{ action: string; content: string }>
): { detected: boolean; reason?: string } {
  if (steps.length === 0) return { detected: false }

  const combined = steps.map((s) => `${s.action} ${s.content}`.toLowerCase())

  // Pattern 1: observe(vuln) → investigate(bypass) → verify(success)
  if (steps.length >= 3) {
    for (let i = 0; i <= steps.length - 3; i++) {
      const a = combined[i]
      const b = combined[i + 1]
      const c = combined[i + 2]
      if (
        (ATTACK_KEYWORDS.observe.test(a) && ATTACK_KEYWORDS.vulnerability.test(a)) &&
        (ATTACK_KEYWORDS.investigate.test(b) && ATTACK_KEYWORDS.bypass.test(b)) &&
        (ATTACK_KEYWORDS.verify.test(c) && ATTACK_KEYWORDS.success.test(c))
      ) {
        return {
          detected: true,
          reason: 'attack chain: observe(vulnerability) → investigate(bypass) → verify(success)',
        }
      }
    }
  }

  // Pattern 2: dangerous term + success term combo in any step
  const fullText = combined.join(' ')
  for (const danger of DANGEROUS_TERMS) {
    if (fullText.includes(danger)) {
      for (const suc of SUCCESS_TERMS) {
        if (fullText.includes(suc)) {
          return {
            detected: true,
            reason: `attack indicator: "${danger}" combined with "${suc}"`,
          }
        }
      }
    }
  }

  // Pattern 3: 3+ consecutive steps with auth/security/permission keywords
  if (steps.length >= 3) {
    let consecutive = 0
    let maxConsecutive = 0
    for (const text of combined) {
      if (ATTACK_KEYWORDS.authSecurity.test(text)) {
        consecutive++
        maxConsecutive = Math.max(maxConsecutive, consecutive)
      } else {
        consecutive = 0
      }
    }
    if (maxConsecutive >= 3) {
      return {
        detected: true,
        reason: `${maxConsecutive} consecutive steps involving auth/security/permission keywords`,
      }
    }
  }

  return { detected: false }
}

// ====== #10 分片注入检测 ======

/**
 * Detect split/fragmented prompt injection across multiple steps.
 * Concatenates all step contents and runs relay injection scan.
 */
export function detectSplitInjection(
  steps: Array<{ content: string }>
): { detected: boolean; reason?: string } {
  if (steps.length === 0) return { detected: false }

  const concatenated = steps.map((s) => s.content).join(' ')
  const result = relaySanitize({ content: concatenated })

  if (result.blocked) {
    return {
      detected: true,
      reason: result.reason ?? 'split injection detected across steps',
    }
  }

  return { detected: false }
}

// ====== #2 dead_ends 敏感度分类 ======

const RESTRICTED_KEYWORDS = [
  'security', 'auth', 'authentication', 'authorization', 'permission',
  'bypass', 'exploit', 'privilege', 'token', 'credential', 'password',
  'injection', 'vulnerability', 'CVE',
]

/**
 * Classify the sensitivity of a dead-end reasoning branch.
 */
export function classifyDeadEndSensitivity(
  tried: string,
  why_abandoned: string
): 'public' | 'restricted' {
  const combined = `${tried} ${why_abandoned}`.toLowerCase()
  for (const kw of RESTRICTED_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) {
      return 'restricted'
    }
  }
  return 'public'
}

// ====== #7 duration 区间化 ======

/**
 * Bucket a duration in seconds into a named range.
 */
export function bucketizeDuration(seconds: number): string {
  if (seconds < 60) return 'under_1min'
  if (seconds < 300) return '1_to_5min'
  if (seconds <= 900) return '5_to_15min'
  return 'over_15min'
}

// ====== #8 tools 泛化 ======

const TOOL_CATEGORIES: Array<{ category: string; keywords: string[] }> = [
  { category: 'shell', keywords: ['exec', 'ssh', 'bash', 'shell', 'zsh', 'sh', 'terminal', 'run'] },
  { category: 'file_ops', keywords: ['read', 'write', 'edit', 'cat', 'ls', 'cp', 'mv', 'rm', 'find', 'grep'] },
  { category: 'network', keywords: ['curl', 'fetch', 'wget', 'http', 'https', 'request', 'axios'] },
  { category: 'vcs', keywords: ['git', 'gh', 'svn', 'hg'] },
]

/**
 * Normalize a list of tool names into broad categories, deduped.
 */
export function categorizeTools(tools: string[]): string[] {
  const seen = new Set<string>()
  for (const tool of tools) {
    const lower = tool.toLowerCase()
    let matched = false
    for (const { category, keywords } of TOOL_CATEGORIES) {
      if (keywords.some((kw) => lower === kw || lower.startsWith(kw))) {
        seen.add(category)
        matched = true
        break
      }
    }
    if (!matched) {
      seen.add('other')
    }
  }
  return Array.from(seen)
}

// ====== #11 difficulty 偏差检测 ======

const DIFFICULTY_LEVELS = ['trivial', 'easy', 'medium', 'hard', 'extreme'] as const
type DifficultyLevel = typeof DIFFICULTY_LEVELS[number]

function rankDifficulty(d: string): number {
  const normalized = d.toLowerCase()
  const idx = DIFFICULTY_LEVELS.indexOf(normalized as DifficultyLevel)
  return idx === -1 ? 2 : idx // default to 'medium' rank if unknown
}

function computeDifficulty(opts: {
  steps_count: number
  dead_ends_count: number
  tools_count: number
}): DifficultyLevel {
  const { steps_count, dead_ends_count } = opts
  if (steps_count >= 15 || dead_ends_count >= 4) return 'extreme'
  if (steps_count >= 8 || dead_ends_count >= 2) return 'hard'
  if (steps_count >= 3 && dead_ends_count <= 1) return 'medium'
  if (steps_count < 3 && dead_ends_count === 0) return 'easy'
  return 'medium'
}

/**
 * Validate claimed difficulty against computed difficulty from metrics.
 * Returns computed difficulty and a 0-1 normalized deviation score.
 */
export function validateDifficulty(
  claimed: { estimated: string; actual: string },
  computed: { steps_count: number; dead_ends_count: number; tools_count: number }
): { valid: boolean; computed_difficulty: string; deviation: number } {
  const computedLevel = computeDifficulty(computed)
  const computedRank = rankDifficulty(computedLevel)

  // Use the claimed actual difficulty for deviation calculation
  const claimedRank = rankDifficulty(claimed.actual)
  const deviation = Math.abs(claimedRank - computedRank) / (DIFFICULTY_LEVELS.length - 1)

  // Valid if deviation is within 1 step (25%)
  const valid = deviation <= 0.25

  return { valid, computed_difficulty: computedLevel, deviation }
}

// ====== #4 fingerprint 模糊化 ======

type Fingerprint = {
  ecosystem: string
  layer: string
  languages: string[]
  frameworks: string[]
}

/**
 * Blur fingerprint data: replace 'security' layer with 'infra' for privacy.
 */
export function sanitizeFingerprint(fp: Fingerprint): Fingerprint {
  return {
    ...fp,
    layer: fp.layer === 'security' ? 'infra' : fp.layer,
  }
}

// ====== 主函数 ======

/**
 * Comprehensive trace sanitization.
 * Runs all checks and returns sanitized trace with safety assessment.
 */
export function sanitizeTrace(trace: unknown): {
  safe: boolean
  sanitized: unknown
  warnings: string[]
} {
  const warnings: string[] = []
  let safe = true

  if (!trace || typeof trace !== 'object') {
    return { safe: true, sanitized: trace, warnings: [] }
  }

  // Deep clone to avoid mutating the original
  let sanitized: Record<string, unknown> = JSON.parse(JSON.stringify(trace))

  // --- Context sanitization (#1) ---
  if (typeof sanitized.context === 'string') {
    sanitized.context = sanitizeContext(sanitized.context)
  }
  if (typeof sanitized.summary === 'string') {
    sanitized.summary = sanitizeContext(sanitized.summary)
  }

  // --- Steps processing ---
  const steps: Array<{ action: string; content: string }> = Array.isArray(sanitized.steps)
    ? (sanitized.steps as Array<unknown>).filter(
        (s): s is { action: string; content: string } =>
          typeof s === 'object' && s !== null &&
          typeof (s as Record<string, unknown>).action === 'string' &&
          typeof (s as Record<string, unknown>).content === 'string'
      )
    : []

  // Sanitize step content
  if (Array.isArray(sanitized.steps)) {
    sanitized.steps = (sanitized.steps as Array<unknown>).map((step) => {
      if (typeof step === 'object' && step !== null) {
        const s = step as Record<string, unknown>
        return {
          ...s,
          content: typeof s.content === 'string' ? sanitizeContext(s.content) : s.content,
        }
      }
      return step
    })
  }

  // --- Attack chain detection (#3) ---
  if (steps.length > 0) {
    const attackResult = detectAttackChain(steps)
    if (attackResult.detected) {
      safe = false
      warnings.push(`attack chain detected: ${attackResult.reason}`)
    }
  }

  // --- Split injection detection (#10) ---
  if (steps.length > 0) {
    const splitResult = detectSplitInjection(steps)
    if (splitResult.detected) {
      safe = false
      warnings.push(`split injection detected: ${splitResult.reason}`)
    }
  }

  // --- dead_ends sensitivity (#2) ---
  if (Array.isArray(sanitized.dead_ends)) {
    sanitized.dead_ends = (sanitized.dead_ends as Array<unknown>).map((de) => {
      if (typeof de === 'object' && de !== null) {
        const d = de as Record<string, unknown>
        const tried = typeof d.tried === 'string' ? d.tried : ''
        const why = typeof d.why_abandoned === 'string' ? d.why_abandoned : ''
        const sensitivity = classifyDeadEndSensitivity(tried, why)
        if (sensitivity === 'restricted') {
          warnings.push(`dead_end marked restricted: "${tried.slice(0, 40)}..."`)
          return { ...d, sensitivity, tried: '[RESTRICTED]', why_abandoned: '[RESTRICTED]' }
        }
        return { ...d, sensitivity }
      }
      return de
    })
  }

  // --- Duration bucketing (#7) ---
  if (typeof sanitized.duration_seconds === 'number') {
    sanitized.duration_bucket = bucketizeDuration(sanitized.duration_seconds)
    delete sanitized.duration_seconds
  }

  // --- Tools categorization (#8) ---
  if (Array.isArray(sanitized.tools)) {
    const toolStrings = (sanitized.tools as Array<unknown>).filter(
      (t): t is string => typeof t === 'string'
    )
    sanitized.tools = categorizeTools(toolStrings)
  }

  // --- Difficulty validation (#11) ---
  if (
    typeof sanitized.difficulty === 'object' &&
    sanitized.difficulty !== null &&
    typeof sanitized.steps === 'object'
  ) {
    const diff = sanitized.difficulty as Record<string, unknown>
    if (typeof diff.estimated === 'string' && typeof diff.actual === 'string') {
      const deadEndsCount = Array.isArray(sanitized.dead_ends) ? sanitized.dead_ends.length : 0
      const toolsCount = Array.isArray(sanitized.tools) ? sanitized.tools.length : 0
      const validation = validateDifficulty(
        { estimated: diff.estimated, actual: diff.actual },
        { steps_count: steps.length, dead_ends_count: deadEndsCount, tools_count: toolsCount }
      )
      sanitized.difficulty = { ...diff, ...validation }
      if (!validation.valid) {
        warnings.push(
          `difficulty deviation too high: claimed="${diff.actual}", computed="${validation.computed_difficulty}", deviation=${validation.deviation.toFixed(2)}`
        )
      }
    }
  }

  // --- Fingerprint blur (#4) ---
  if (
    typeof sanitized.fingerprint === 'object' &&
    sanitized.fingerprint !== null
  ) {
    const fp = sanitized.fingerprint as Record<string, unknown>
    if (
      typeof fp.ecosystem === 'string' &&
      typeof fp.layer === 'string' &&
      Array.isArray(fp.languages) &&
      Array.isArray(fp.frameworks)
    ) {
      sanitized.fingerprint = sanitizeFingerprint({
        ecosystem: fp.ecosystem,
        layer: fp.layer,
        languages: fp.languages as string[],
        frameworks: fp.frameworks as string[],
      })
    }
  }

  return { safe, sanitized, warnings }
}
