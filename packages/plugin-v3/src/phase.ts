// Phase inference for memory-prompt selection (M7 Batch 2). Pure
// function: four-value enum derived from recently observed keywords
// and the running tool-call count. Kept deliberately small; any
// richer signal (e.g. confidence scoring, sliding windows) can be
// added without widening the enum.
export type Phase = 'stuck' | 'evaluating' | 'planning' | 'executing'

export interface PhaseInput {
  keywords: readonly string[]
  toolCount: number
}

const STUCK_KEYWORDS = new Set([
  'error',
  'failed',
  'fail',
  'cannot',
  'why',
  'retry',
  'timeout',
  'broken',
  'stuck',
])

const EVALUATING_KEYWORDS = new Set([
  'compare',
  'decide',
  'test',
  'verify',
  'check',
  'diff',
  'review',
])

const EXECUTING_KEYWORDS = new Set([
  'implement',
  'build',
  'write',
  'patch',
  'apply',
  'create',
  'edit',
])

const HIGH_TOOL_COUNT = 5

export function inferPhase({ keywords, toolCount }: PhaseInput): Phase {
  const normalized = keywords.map((k) => k.toLowerCase())

  if (normalized.some((k) => STUCK_KEYWORDS.has(k))) return 'stuck'
  if (normalized.some((k) => EVALUATING_KEYWORDS.has(k))) return 'evaluating'
  if (normalized.some((k) => EXECUTING_KEYWORDS.has(k))) return 'executing'

  if (toolCount >= HIGH_TOOL_COUNT) return 'executing'
  return 'planning'
}
