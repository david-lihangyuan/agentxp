// Module-level per-session activity tracker used by the memory
// supplements (M7 Batch 2). OpenClaw's MemoryPromptSectionBuilder
// signature has no session parameter, so the builder must look up
// the current session here. Hooks write; the prompt builder reads.
//
// Design notes:
// - `toolCount` is a running total; `toolNames` is a bounded tail
//   for phase inference. Keeping them separate lets the prompt
//   builder surface phase ("first message? executing for a while?")
//   without having to paginate the full history.
// - `keywords` stay deduplicated and bounded; recency wins on
//   overflow.
// - State is process-local and lost on restart. Plugin v3 already
//   treats the staged DB as durable truth; this cache is an
//   optimisation.

export const MAX_TOOL_HISTORY = 32
export const MAX_KEYWORD_HISTORY = 32

export interface SessionState {
  toolNames: string[]
  toolCount: number
  keywords: string[]
}

const state = new Map<string, SessionState>()
let lastActiveSession: string | undefined

function ensure(sessionId: string): SessionState {
  let s = state.get(sessionId)
  if (!s) {
    s = { toolNames: [], toolCount: 0, keywords: [] }
    state.set(sessionId, s)
  }
  return s
}

export function setLastActiveSession(sessionId: string): void {
  lastActiveSession = sessionId
  ensure(sessionId)
}

export function getLastActiveSession(): string | undefined {
  return lastActiveSession
}

export function getSessionState(sessionId: string): SessionState | undefined {
  return state.get(sessionId)
}

export function pushToolName(sessionId: string, toolName: string): void {
  const s = ensure(sessionId)
  s.toolNames.push(toolName)
  if (s.toolNames.length > MAX_TOOL_HISTORY) {
    s.toolNames.splice(0, s.toolNames.length - MAX_TOOL_HISTORY)
  }
  s.toolCount += 1
}

export function pushKeywords(sessionId: string, keywords: readonly string[]): void {
  const s = ensure(sessionId)
  const seen = new Set(s.keywords)
  for (const k of keywords) {
    if (!k) continue
    if (seen.has(k)) continue
    s.keywords.push(k)
    seen.add(k)
  }
  if (s.keywords.length > MAX_KEYWORD_HISTORY) {
    s.keywords.splice(0, s.keywords.length - MAX_KEYWORD_HISTORY)
  }
}

export function resetSessionState(): void {
  state.clear()
  lastActiveSession = undefined
}
