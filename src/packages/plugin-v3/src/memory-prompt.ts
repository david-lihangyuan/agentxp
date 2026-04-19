// MemoryPromptSectionBuilder implementation (M7 Batch 2). The SDK
// signature is synchronous and session-less: we read the current
// session from the shared session-state module and perform a sync
// tag-match against the staged_experiences table. On every empty
// guard we return [] so the host's prompt composer skips the
// section cleanly.
import type { PluginDb } from './db.js'
import { searchStagedSync, type CorpusScope, type SearchStagedOptions } from './memory-corpus.js'
import { inferPhase, type Phase } from './phase.js'
import { getLastActiveSession, getSessionState } from './session-state.js'

// Structural copy of the OpenClaw MemoryPromptSectionBuilder type.
// Inlined because the host does not re-export it from its public
// entry points; registration is duck-typed.
export type MemoryPromptSectionBuilder = (params: {
  availableTools: Set<string>
  citationsMode?: string
}) => string[]

export interface PromptBuilderOptions {
  scope?: CorpusScope
  maxResults?: number
}

const DEFAULT_MAX_RESULTS = 3

const PHASE_HINT: Record<Phase, string> = {
  stuck: 'You may be **stuck** — review mistakes below before retrying.',
  evaluating: 'You are **evaluating** options — prior outcomes follow.',
  planning: 'You are **planning** — related prior experiences follow.',
  executing: 'You are **executing** — check if any of the below applies.',
}

export function createPromptBuilder(
  db: PluginDb,
  options: PromptBuilderOptions = {},
): MemoryPromptSectionBuilder {
  const scope = options.scope
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS

  return (_params: { availableTools: Set<string>; citationsMode?: string }): string[] => {
    const sessionKey = getLastActiveSession()
    if (!sessionKey) return []

    const state = getSessionState(sessionKey)
    if (!state || state.keywords.length === 0) return []

    const searchOpts: SearchStagedOptions = { maxResults }
    if (scope !== undefined) searchOpts.scope = scope
    const query = state.keywords.join(' ')
    const hits = searchStagedSync(db, query, searchOpts)
    if (hits.length === 0) return []

    const phase = inferPhase({ keywords: state.keywords, toolCount: state.toolCount })

    const lines: string[] = []
    lines.push('## Past AgentXP Experiences')
    lines.push('')
    lines.push(`_Phase: **${phase}**._ ${PHASE_HINT[phase]}`)
    lines.push('')
    for (const hit of hits) {
      const title = hit.title ?? hit.path
      const snippet = hit.snippet.replace(/\s+/g, ' ').trim()
      lines.push(`- **${title}** — ${snippet} _(${hit.path})_`)
    }
    return lines
  }
}
