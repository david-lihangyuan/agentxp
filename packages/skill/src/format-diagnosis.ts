// format-diagnosis.ts — Format a DiagnosisReport as a terminal string.
// Uses unicode box-drawing characters only. No external dependencies.

import type { DiagnosisReport, SubPatternMatch } from './diagnose.js'

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

/**
 * Build a narrative sentence from the active sub-patterns of a pattern.
 * Active = count > 0.
 *
 * Format:
 *   "Your agent {desc1}, {desc2}, and {desc3}."
 *   "Your agent {desc1} and {desc2}."
 *   "Your agent {desc1}."
 */
function buildNarrative(subPatterns: SubPatternMatch[]): string {
  const active = subPatterns
    .filter(sp => sp.count > 0)
    .map(sp => {
      const desc = sp.description.replace('{count}', String(sp.count))
      // Fix "1 times" → "1 time"
      return sp.count === 1 ? desc.replace(/1 times/g, '1 time') : desc
    })

  if (active.length === 0) return ''
  if (active.length === 1) return `  Your agent ${active[0]}.`

  const allButLast = active.slice(0, -1)
  const last = active[active.length - 1]

  // Join with commas; last item gets "and"
  const joined = allButLast.join(',\n  ') + ',\n  and ' + last + '.'
  return `  Your agent ${joined}`
}

/**
 * Format a DiagnosisReport into a human-readable terminal string.
 */
export function formatDiagnosis(report: DiagnosisReport): string {
  const lines: string[] = []

  lines.push('')
  lines.push(RULE)
  lines.push('')
  lines.push('  🧠 AgentXP Diagnosis Report')
  lines.push('')

  if (report.filesScanned === 0 || report.patterns.length === 0) {
    lines.push('  No agent memory found — starting fresh.')
    lines.push('  Your agent will build error patterns as it works.')
    lines.push('  After the first few tasks, run `agentxp diagnose` to see what it learned.')
    lines.push('')
    lines.push(RULE)
    return lines.join('\n')
  }

  lines.push(`  Scanned: ${report.filesScanned} files across ${report.daysSpan} days`)
  lines.push(`  Found: ${report.patterns.length} recurring pattern${report.patterns.length !== 1 ? 's' : ''}`)
  lines.push('')
  lines.push(RULE)

  for (let i = 0; i < report.patterns.length; i++) {
    const pattern = report.patterns[i]
    lines.push('')
    lines.push(`  #${i + 1} ${pattern.title} (${pattern.count} times)`)
    lines.push('')

    const narrative = buildNarrative(pattern.subPatterns)
    if (narrative) {
      lines.push(narrative)
    }

    lines.push('')
    lines.push(`  ✅ Added rule: ${pattern.reflection}`)
    lines.push('')
    lines.push(RULE)
  }

  lines.push('')
  lines.push('  These patterns are now in your agent\'s memory.')
  lines.push('  They won\'t disappear completely, but based on testing,')
  lines.push('  repeat errors drop by ~80%.')
  lines.push('')
  lines.push('  → reflection/mistakes.md')
  lines.push('')
  lines.push(RULE)

  return lines.join('\n')
}
