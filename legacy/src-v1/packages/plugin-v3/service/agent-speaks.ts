/**
 * agent-speaks.ts — Repeated pattern detection (§14.4 Agent Speaks)
 *
 * Detects when the same mistake pattern appears 3+ times in 7 days.
 * Tone: observation, not complaint. Question, not demand.
 * Example: "I've noticed [pattern] appeared 3 times in the last 7 days.
 *           Is there something about [context] that I'm consistently misunderstanding?"
 */

import type { Db } from '../db.js'

export interface AgentSpeaksAlert {
  pattern: string
  count: number
  message: string
}

export interface AgentSpeaksOptions {
  windowDays?: number
  threshold?: number
  dryRun?: boolean
}

/**
 * Detect repeated mistake patterns within a time window.
 * Returns alerts for patterns that cross the threshold and haven't been reported.
 */
export async function detectRepeatedPatterns(
  db: Db,
  opts: AgentSpeaksOptions = {},
): Promise<AgentSpeaksAlert[]> {
  const windowDays = opts.windowDays ?? 7
  const threshold = opts.threshold ?? 3
  const dryRun = opts.dryRun ?? false

  const alerts: AgentSpeaksAlert[] = []
  const now = Date.now()
  const windowStart = now - windowDays * 24 * 60 * 60 * 1000

  // Get recent mistakes within the window
  const mistakes = db.db.prepare(`
    SELECT title, created_at 
    FROM reflections 
    WHERE category = 'mistake' 
      AND created_at >= ?
    ORDER BY created_at DESC
  `).all(windowStart) as { title: string; created_at: number }[]

  if (mistakes.length < threshold) {
    return [] // Not enough data
  }

  // Tokenize titles and count patterns
  const patternCounts = new Map<string, number>()

  for (const mistake of mistakes) {
    // Simple tokenization: lowercase, split by spaces, filter out short words
    const tokens = mistake.title
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.length >= 3 && /^[a-z0-9_-]+$/.test(token))

    for (const token of tokens) {
      patternCounts.set(token, (patternCounts.get(token) || 0) + 1)
    }
  }

  // Find patterns crossing the threshold
  for (const [pattern, count] of patternCounts.entries()) {
    if (count < threshold) continue

    // Check if already reported (using plugin_state)
    const stateKey = `agent_speaks:${pattern}`
    const existing = db.getPluginState.get(stateKey) as { value: string } | undefined
    
    if (existing) {
      const lastReported = parseInt(existing.value, 10)
      const daysSinceReport = (now - lastReported) / (1000 * 60 * 60 * 24)
      if (daysSinceReport < 14) {
        continue // Don't spam: wait 14 days before reporting same pattern again
      }
    }

    // Generate observation-style message
    const message = `I've noticed "${pattern}" appeared ${count} times in the last ${windowDays} days.
Is there something about this pattern that I'm consistently misunderstanding?`

    alerts.push({ pattern, count, message })

    // Mark as reported (unless dry run)
    if (!dryRun) {
      (db.setPluginState as any).run(stateKey, now.toString(), now)
    }
  }

  return alerts
}
