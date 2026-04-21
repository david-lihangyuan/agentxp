// MemoryCorpusSupplement backed by the local staged_experiences
// table (M7 Batch 2). The host asks us to search; we tag-match
// against data_json + tags_json and return OpenClaw-shaped rows.
// No schema change: visibility is read from data_json if present,
// defaulted to 'unlisted' when missing.
import type { PluginDb, StagedExperience } from './db.js'

// Structural copies of the OpenClaw Memory SDK shapes. Inlined here
// because the host package does not re-export them from its public
// entry points; the plugin registers via duck-typed api methods so
// structural compatibility is sufficient.
export interface MemoryCorpusSearchResult {
  corpus: string
  path: string
  title?: string
  kind?: string
  score: number
  snippet: string
  id?: string
  startLine?: number
  endLine?: number
  citation?: string
  source?: string
  provenanceLabel?: string
  sourceType?: string
  sourcePath?: string
  updatedAt?: string
}

export interface MemoryCorpusGetResult {
  corpus: string
  path: string
  title?: string
  kind?: string
  content: string
  fromLine: number
  lineCount: number
  id?: string
  provenanceLabel?: string
  sourceType?: string
  sourcePath?: string
  updatedAt?: string
}

export interface MemoryCorpusSupplement {
  search(params: {
    query: string
    maxResults?: number
    agentSessionKey?: string
  }): Promise<MemoryCorpusSearchResult[]>
  get(params: {
    lookup: string
    fromLine?: number
    lineCount?: number
    agentSessionKey?: string
  }): Promise<MemoryCorpusGetResult | null>
}

export type CorpusScope = 'public-only' | 'all'

export interface CorpusSupplementOptions {
  scope?: CorpusScope
}

const DEFAULT_MAX_RESULTS = 5
const LOOKUP_PREFIX = 'agentxp://staged/'

interface ParsedRow {
  row: StagedExperience
  title: string
  tried: string
  learned: string
  outcome: string
  tags: string[]
  visibility: 'public' | 'unlisted' | 'private'
  haystack: string
}

function parseRow(row: StagedExperience): ParsedRow {
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(row.data_json)
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    // Corrupt rows are skipped by returning an empty haystack.
  }
  let tags: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.tags_json)
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
  } catch {
    // ignore
  }
  const title = typeof data.what === 'string' ? data.what : ''
  const tried = typeof data.tried === 'string' ? data.tried : ''
  const learned = typeof data.learned === 'string' ? data.learned : ''
  const outcome = typeof data.outcome === 'string' ? data.outcome : ''
  const rawVis = typeof data.visibility === 'string' ? data.visibility : 'unlisted'
  const visibility: ParsedRow['visibility'] =
    rawVis === 'public' || rawVis === 'private' ? rawVis : 'unlisted'
  const haystack = [title, tried, learned, outcome, ...tags].join(' ').toLowerCase()
  return { row, title, tried, learned, outcome, tags, visibility, haystack }
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 2)
}

function scoreRow(parsed: ParsedRow, tokens: string[]): number {
  let hits = 0
  for (const tok of tokens) if (parsed.haystack.includes(tok)) hits += 1
  return hits
}

function toSearchResult(parsed: ParsedRow, score: number): MemoryCorpusSearchResult {
  const id = String(parsed.row.id)
  const snippet = parsed.learned || parsed.tried || parsed.title || '(no summary)'
  return {
    corpus: 'agentxp',
    path: `${LOOKUP_PREFIX}${id}`,
    id,
    title: parsed.title || `staged experience #${id}`,
    kind: 'reasoning_trace',
    score,
    snippet,
    provenanceLabel: 'AgentXP',
    sourceType: 'staged-experience',
    sourcePath: `${LOOKUP_PREFIX}${id}`,
    updatedAt: new Date(parsed.row.created_at * 1000).toISOString(),
  }
}

function toMarkdown(parsed: ParsedRow): string {
  const lines = [
    `# ${parsed.title || `staged experience #${parsed.row.id}`}`,
    '',
    `- outcome: ${parsed.outcome || 'unknown'}`,
    `- tags: ${parsed.tags.length > 0 ? parsed.tags.join(', ') : '(none)'}`,
    '',
    '## What',
    parsed.title,
    '',
    '## Tried',
    parsed.tried,
    '',
    '## Learned',
    parsed.learned,
  ]
  return lines.join('\n')
}

export interface SearchStagedOptions {
  scope?: CorpusScope
  maxResults?: number
}

// Synchronous variant of the corpus search, reused by the prompt
// builder (whose SDK signature is synchronous). Shares parsing,
// tokenising, scoring and ranking with the async `search`.
export function searchStagedSync(
  db: PluginDb,
  query: string,
  options: SearchStagedOptions = {},
): MemoryCorpusSearchResult[] {
  const scope: CorpusScope = options.scope ?? 'all'
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const rows = db.listAllExperiences().map(parseRow)
  const filtered = rows.filter((p) => (scope === 'public-only' ? p.visibility === 'public' : true))
  const scored = filtered.map((p) => ({ p, score: scoreRow(p, tokens) })).filter((x) => x.score > 0)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.p.row.id - a.p.row.id
  })
  const limit = Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS)
  return scored.slice(0, limit).map((x) => toSearchResult(x.p, x.score))
}

export function createCorpusSupplement(
  db: PluginDb,
  options: CorpusSupplementOptions = {},
): MemoryCorpusSupplement {
  // Default to 'all': staged experiences are the author's own
  // memory. Hosts that expose a shared corpus across agents opt into
  // 'public-only' to enforce visibility.
  const scope: CorpusScope = options.scope ?? 'all'

  const supplement: MemoryCorpusSupplement = {
    async search(params: { query: string; maxResults?: number; agentSessionKey?: string }) {
      const opts: SearchStagedOptions = { scope }
      if (params.maxResults !== undefined) opts.maxResults = params.maxResults
      return searchStagedSync(db, params.query, opts)
    },

    async get(params: {
      lookup: string
      fromLine?: number
      lineCount?: number
      agentSessionKey?: string
    }) {
      if (!params.lookup.startsWith(LOOKUP_PREFIX)) return null
      const idStr = params.lookup.slice(LOOKUP_PREFIX.length)
      const id = Number(idStr)
      if (!Number.isInteger(id) || id <= 0) return null
      const row = db.listAllExperiences().find((r) => r.id === id)
      if (!row) return null
      const parsed = parseRow(row)
      if (scope === 'public-only' && parsed.visibility !== 'public') return null
      const content = toMarkdown(parsed)
      const lineCount = content.split('\n').length
      const result: MemoryCorpusGetResult = {
        corpus: 'agentxp',
        path: params.lookup,
        id: String(row.id),
        title: parsed.title || `staged experience #${row.id}`,
        kind: 'reasoning_trace',
        content,
        fromLine: 1,
        lineCount,
        provenanceLabel: 'AgentXP',
        sourceType: 'staged-experience',
        sourcePath: params.lookup,
        updatedAt: new Date(row.created_at * 1000).toISOString(),
      }
      return result
    },
  }
  return supplement
}
