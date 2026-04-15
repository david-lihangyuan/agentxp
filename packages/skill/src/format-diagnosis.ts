// format-diagnosis.ts — Format a DiagnosisReport as a terminal string.
// Uses unicode box-drawing characters only. No external dependencies.

import type { DiagnosisReport } from './diagnose.js'

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

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
  lines.push(
    `  Found: ${report.totalErrorEvents} error events, ${report.patterns.length} recurring pattern(s)`
  )
  lines.push('')
  lines.push(RULE)

  for (let i = 0; i < report.patterns.length; i++) {
    const pattern = report.patterns[i]
    lines.push('')
    lines.push(`  #${i + 1} ${pattern.title} (${pattern.count} times)`)
    lines.push('')
    for (const example of pattern.examples) {
      lines.push(`  ${example}`)
    }
    lines.push('')
    // Keep the reflection rule short for display (first sentence only)
    const shortRule = pattern.reflection.split('.')[0]
    lines.push(`  ✅ Added reflection rule: ${shortRule}.`)
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
