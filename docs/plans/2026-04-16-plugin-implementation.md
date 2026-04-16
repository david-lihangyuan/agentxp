# AgentXP OpenClaw Plugin — Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Rewrite the full AgentXP SDK as an OpenClaw native plugin, using first-class Plugin SDK capabilities (Memory Corpus/Prompt Supplement, hooks, services, tools, CLI, commands, HTTP routes) with D' selective injection strategy.

**Architecture:** Plugin registers as a non-capability feature plugin (`definePluginEntry`). Core data in SQLite via `better-sqlite3`. Serendip protocol from `@serendip/protocol` workspace dependency. Two hooks (message_sending + before_tool_call), one background service, Memory Corpus + Prompt Supplement for injection, optional tools, chat commands, CLI, and HTTP routes.

**Tech Stack:**
- TypeScript (ESM, strict mode)
- OpenClaw Plugin SDK (`openclaw/plugin-sdk/*`)
- better-sqlite3 (SQLite storage)
- @serendip/protocol (signing/keys)
- @sinclair/typebox (tool parameter schemas)
- vitest (testing)

**Package:** `packages/plugin` in agentxp monorepo → published as `@agentxp/plugin`

---

## Task 1: Package scaffold + manifest + entry point

**Files:**
- Create: `packages/plugin/package.json`
- Create: `packages/plugin/openclaw.plugin.json`
- Create: `packages/plugin/tsconfig.json`
- Create: `packages/plugin/src/index.ts`
- Create: `packages/plugin/src/types.ts`
- Test: `packages/plugin/tests/entry.test.ts`

**Step 1: Write the failing test**
```typescript
// tests/entry.test.ts
import { describe, it, expect } from 'vitest'

describe('plugin entry', () => {
  it('exports a valid plugin definition', async () => {
    const mod = await import('../src/index.js')
    const entry = mod.default
    expect(entry).toBeDefined()
    expect(entry.id).toBe('agentxp')
    expect(entry.name).toBe('AgentXP')
    expect(typeof entry.register).toBe('function')
  })
})
```

**Step 2: Run test — confirm it fails**
Command: `cd packages/plugin && npx vitest run tests/entry.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

`package.json`:
```json
{
  "name": "@agentxp/plugin",
  "version": "0.1.0",
  "description": "AgentXP — teach every AI agent to learn from experience",
  "type": "module",
  "main": "./dist/index.js",
  "exports": { ".": "./dist/index.js" },
  "openclaw": {
    "extensions": ["./src/index.ts"],
    "compat": {
      "pluginApi": ">=2026.4.14",
      "minGatewayVersion": "2026.4.14"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@serendip/protocol": "workspace:*",
    "better-sqlite3": "^12.8.0"
  },
  "devDependencies": {
    "@sinclair/typebox": "^0.34.0",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^25.6.0",
    "typescript": "^5.4.5",
    "vitest": "^4.1.4"
  },
  "peerDependencies": {
    "openclaw": ">=2026.4.14"
  },
  "publishConfig": { "access": "public" }
}
```

`openclaw.plugin.json`:
```json
{
  "id": "agentxp",
  "name": "AgentXP",
  "description": "Agent experience learning and sharing — every agent learns from global experience",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["local", "network"],
        "default": "local",
        "description": "local = pure local, network = sync with relay"
      },
      "relay": {
        "type": "object",
        "properties": {
          "url": { "type": "string", "default": "https://relay.agentxp.io" }
        }
      },
      "maxInjectionTokens": {
        "type": "number",
        "default": 500,
        "description": "Max tokens to inject per prompt (~500 tokens/request)"
      },
      "autoPublish": {
        "type": "boolean",
        "default": false,
        "description": "Auto-publish distilled experiences to relay"
      },
      "weaning": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean", "default": true },
          "rate": { "type": "number", "default": 0.1 }
        }
      },
      "weeklyDigest": { "type": "boolean", "default": true }
    }
  }
}
```

`src/types.ts`:
```typescript
export interface PluginConfig {
  mode: 'local' | 'network'
  relay: { url: string }
  maxInjectionTokens: number
  autoPublish: boolean
  weaning: { enabled: boolean; rate: number }
  weeklyDigest: boolean
}

export const DEFAULT_CONFIG: PluginConfig = {
  mode: 'local',
  relay: { url: 'https://relay.agentxp.io' },
  maxInjectionTokens: 500,
  autoPublish: false,
  weaning: { enabled: true, rate: 0.1 },
  weeklyDigest: true,
}
```

`src/index.ts`:
```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'

export default definePluginEntry({
  id: 'agentxp',
  name: 'AgentXP',
  description: 'Agent experience learning and sharing — every agent learns from global experience',
  register(api) {
    // Tasks 2-14 will register capabilities here
  },
})
```

**Step 4: Run test — confirm it passes**
Command: `cd packages/plugin && npx vitest run tests/entry.test.ts`
Expected: PASS

**Step 5: Commit**
`git add packages/plugin && git commit -m "feat(plugin): scaffold package + manifest + entry point"`

---

## Task 2: SQLite storage layer

**Files:**
- Create: `packages/plugin/src/db.ts`
- Test: `packages/plugin/tests/db.test.ts`

**Step 1: Write the failing test**
```typescript
// tests/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb, closeDb, type AgentXPDb } from '../src/db.js'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('db', () => {
  let tmpDir: string
  let db: AgentXPDb

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentxp-test-'))
    db = createDb(join(tmpDir, 'agentxp.db'))
  })

  afterEach(() => {
    closeDb(db)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates all required tables', () => {
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain('local_lessons')
    expect(names).toContain('trace_steps')
    expect(names).toContain('feedback')
    expect(names).toContain('published_log')
    expect(names).toContain('injection_log')
    expect(names).toContain('context_cache')
  })

  it('inserts and retrieves a lesson', () => {
    db.insertLesson({
      what: 'vitest config',
      tried: 'used default config',
      outcome: 'succeeded',
      learned: 'vitest works out of the box with TypeScript ESM',
      source: 'local',
      tags: ['testing', 'vitest'],
    })
    const results = db.searchLessons('vitest', 5)
    expect(results.length).toBe(1)
    expect(results[0].what).toBe('vitest config')
  })

  it('inserts and retrieves a trace step', () => {
    db.insertTraceStep({
      sessionId: 'test-session',
      action: 'investigate',
      content: 'reading source code',
      significance: 'routine',
      toolName: 'read',
      timestamp: Date.now(),
    })
    const steps = db.getTraceSteps('test-session')
    expect(steps.length).toBe(1)
    expect(steps[0].action).toBe('investigate')
  })

  it('records and queries injection log', () => {
    db.recordInjection({ sessionId: 's1', injected: true, tokenCount: 450, lessonIds: [1, 2] })
    db.recordInjection({ sessionId: 's2', injected: false, tokenCount: 0, lessonIds: [] })
    const stats = db.getInjectionStats()
    expect(stats.totalSessions).toBe(2)
    expect(stats.injectedSessions).toBe(1)
  })

  it('inserts and queries published log', () => {
    db.recordPublish({ lessonId: 1, relayEventId: 'evt-123', publishedAt: Date.now() })
    const log = db.getPublishedLog(10)
    expect(log.length).toBe(1)
    expect(log[0].relayEventId).toBe('evt-123')
  })

  it('records and queries feedback', () => {
    db.recordFeedback({ lessonId: 1, type: 'cited', sessionId: 's1' })
    db.recordFeedback({ lessonId: 1, type: 'verified', sessionId: 's2' })
    const summary = db.getFeedbackSummary(1)
    expect(summary.cited).toBe(1)
    expect(summary.verified).toBe(1)
  })

  it('updates context cache', () => {
    db.updateContextCache('session-1', ['vitest', 'typescript', 'plugin'])
    const keywords = db.getContextCache('session-1')
    expect(keywords).toEqual(['vitest', 'typescript', 'plugin'])
  })
})
```

**Step 2: Run test — confirm it fails**

**Step 3: Write implementation**

`src/db.ts` — Full SQLite layer with tables:
- `local_lessons` (id, what, tried, outcome, learned, source, tags, relevance_score, applied_count, success_count, created_at, updated_at, outdated, embedding BLOB)
- `trace_steps` (id, session_id, action, action_raw, content, significance, tool_name, references, timestamp)
- `feedback` (id, lesson_id, type, session_id, comment, created_at)
- `published_log` (id, lesson_id, relay_event_id, published_at, unpublished_at)
- `injection_log` (id, session_id, injected, token_count, lesson_ids, created_at)
- `context_cache` (session_id, keywords, updated_at)

Key methods: `insertLesson`, `searchLessons` (FTS5 full-text search), `insertTraceStep`, `getTraceSteps`, `recordInjection`, `getInjectionStats`, `recordPublish`, `getPublishedLog`, `recordFeedback`, `getFeedbackSummary`, `updateContextCache`, `getContextCache`, `getLessonById`, `updateLessonScore`, `markOutdated`, `unpublish`.

**Step 4: Run test — confirm it passes**
**Step 5: Commit**
`git commit -m "feat(plugin): SQLite storage layer with FTS5 search"`

---

## Task 3: Sanitize + context wrapper (port from skill)

**Files:**
- Create: `packages/plugin/src/sanitize.ts`
- Create: `packages/plugin/src/context-wrapper.ts`
- Test: `packages/plugin/tests/sanitize.test.ts`
- Test: `packages/plugin/tests/context-wrapper.test.ts`

Port the existing sanitize.ts (injection detection, unicode detection, credential detection) and context-wrapper.ts (XML safe wrapping) from `packages/skill/src/`. Adapt to use the DB lesson type instead of raw relay experience type.

Tests: 20 injection patterns, 15 unicode patterns, 11 credential patterns, wrapping correctness, HTML entity escaping.

**Commit:** `feat(plugin): port sanitize + context-wrapper from skill`

---

## Task 4: D' selective injection engine

**Files:**
- Create: `packages/plugin/src/injection-engine.ts`
- Test: `packages/plugin/tests/injection-engine.test.ts`

**Core logic:**
1. Accept current context keywords + phase (planning/executing/stuck/evaluating)
2. Query SQLite FTS5 for matching local lessons
3. If network mode: query relay search API (2s timeout, fail-open)
4. Score and rank results: relevance × phase weight
5. Filter: relevance > 0.7 only
6. Select top 2-3 experiences within maxInjectionTokens budget
7. Wrap in context-wrapper with [AgentXP] markers
8. Weaning: 10% probability return empty (configurable)
9. Return formatted injection string + metadata (which lessons, token count)

**Port phase inference from skill:** `inferPhase()` and `phaseWeight()` from proactive-recall.ts.

Tests: keyword extraction, phase inference, relevance scoring, token budget enforcement, weaning probability, relay timeout fallback, empty result handling.

**Commit:** `feat(plugin): D' selective injection engine`

---

## Task 5: Experience extraction engine

**Files:**
- Create: `packages/plugin/src/extraction-engine.ts`
- Test: `packages/plugin/tests/extraction-engine.test.ts`

**Core logic:**
Extract learned experiences from agent message_sending hook data:
1. From tool calls: detect solution patterns (tool succeeded + specific output)
2. From text replies: detect solution completion patterns ("solved", "fixed", "the issue was")
3. Extract what/tried/outcome/learned fields using rule-based parsing
4. Quality gate: field length checks, concrete detail detection (reuse from publisher.ts qualityGate)
5. Sanitize extracted content (NER entity detection for privacy)
6. Return structured experience or null

Tests: tool call extraction, text pattern detection, quality gate pass/fail, privacy sanitization, edge cases (empty, too short, vague).

**Commit:** `feat(plugin): experience extraction engine`

---

## Task 6: Register Memory Corpus Supplement

**Files:**
- Create: `packages/plugin/src/memory-corpus.ts`
- Modify: `packages/plugin/src/index.ts` (register corpus)
- Test: `packages/plugin/tests/memory-corpus.test.ts`

**Implementation:**
Register `api.registerMemoryCorpusSupplement()` with:
- `search(params)`: query SQLite FTS5 + optionally relay. Return results as `MemoryCorpusSearchResult[]` with `corpus: 'agentxp'`, proper scores, snippets, citations
- `get(params)`: lookup a specific lesson by id, return as `MemoryCorpusGetResult`

This makes agent's `memory_search` automatically include AgentXP experiences when `corpus=all`.

Tests: search returns formatted results, get returns single lesson, relay fallback, empty results, sanitize filters.

**Commit:** `feat(plugin): register Memory Corpus Supplement`

---

## Task 7: Register Memory Prompt Supplement (D' injection)

**Files:**
- Create: `packages/plugin/src/memory-prompt.ts`
- Modify: `packages/plugin/src/index.ts` (register supplement)
- Test: `packages/plugin/tests/memory-prompt.test.ts`

**Implementation:**
Register `api.registerMemoryPromptSupplement()` with builder that:
1. Reads context_cache from SQLite (keywords from last message_sending)
2. Calls injection-engine with cached keywords + config
3. Returns `string[]` (prompt lines) wrapped in [AgentXP] markers
4. Tracks injection in injection_log table
5. Respects weaning config (10% skip)
6. Returns empty if no cached context yet (first message in session)

Tests: injection with cached context, weaning skip, empty cache, token budget respect, [AgentXP] marker presence.

**Commit:** `feat(plugin): register Memory Prompt Supplement with D' injection`

---

## Task 8: message_sending hook (extraction + context caching)

**Files:**
- Create: `packages/plugin/src/hooks/message-sending.ts`
- Modify: `packages/plugin/src/index.ts` (register hook)
- Test: `packages/plugin/tests/hooks/message-sending.test.ts`

**Implementation:**
Register `api.registerHook('message_sending', handler)`:
1. Extract keywords from agent reply → update context_cache in SQLite
2. Call extraction-engine to detect learned experiences
3. If experience extracted → insert into local_lessons
4. Check if injection was active this session → record outcome feedback
5. Return `{ cancel: false }` always — never block sending

Tests: keyword caching, experience extraction and storage, outcome recording, always returns cancel:false, error resilience (never throws).

**Commit:** `feat(plugin): message_sending hook for extraction + context caching`

---

## Task 9: before_tool_call hook (L2 trace recording)

**Files:**
- Create: `packages/plugin/src/hooks/before-tool-call.ts`
- Modify: `packages/plugin/src/index.ts` (register hook)
- Test: `packages/plugin/tests/hooks/before-tool-call.test.ts`

**Implementation:**
Register `api.registerHook('before_tool_call', handler)`:
1. Normalize tool name → TraceAction using TraceRecorder.normalizeAction
2. Insert TraceStep into SQLite trace_steps table
3. Return `{ block: false }` always — never block tool calls

Tests: action normalization, step insertion, always returns block:false, handles unknown tools gracefully.

**Commit:** `feat(plugin): before_tool_call hook for L2 trace recording`

---

## Task 10: Background service (distill + publish + pull + feedback + outdated + trace + keys + digest)

**Files:**
- Create: `packages/plugin/src/service.ts`
- Create: `packages/plugin/src/service/distiller.ts`
- Create: `packages/plugin/src/service/publisher.ts`
- Create: `packages/plugin/src/service/puller.ts`
- Create: `packages/plugin/src/service/feedback-loop.ts`
- Create: `packages/plugin/src/service/outdated-detector.ts`
- Create: `packages/plugin/src/service/trace-evaluator.ts`
- Create: `packages/plugin/src/service/key-manager.ts`
- Create: `packages/plugin/src/service/weekly-digest.ts`
- Modify: `packages/plugin/src/index.ts` (register service)
- Test: `packages/plugin/tests/service/distiller.test.ts`
- Test: `packages/plugin/tests/service/publisher.test.ts`
- Test: `packages/plugin/tests/service/puller.test.ts`
- Test: `packages/plugin/tests/service/feedback-loop.test.ts`
- Test: `packages/plugin/tests/service/outdated-detector.test.ts`
- Test: `packages/plugin/tests/service/trace-evaluator.test.ts`
- Test: `packages/plugin/tests/service/key-manager.test.ts`
- Test: `packages/plugin/tests/service/weekly-digest.test.ts`

**Main service loop** (`service.ts`):
- Register via `api.registerService({ start, stop })`
- On start: run each sub-service on appropriate schedule
- Idle check: only run distiller/publisher when new content exists
- On stop: clean shutdown

**Sub-services:**

| Sub-service | Trigger | Logic |
|---|---|---|
| distiller | new lessons count > threshold | Group by pattern, generate strategy rules (port from distill.ts) |
| publisher | autoPublish=true + new distilled | Sign with Serendip protocol, POST to relay, retry queue |
| puller | network mode, every 30min | Fetch new network experiences, sanitize, insert into local_lessons with source='network' |
| feedback-loop | after publish | Check relay for feedback on our published experiences, update scores |
| outdated-detector | daily | Check lessons with 3+ contradicted feedback, mark outdated |
| trace-evaluator | new trace completed | Assess worthiness (steps >= 3 + dead_ends/backtrack), publish high-value traces |
| key-manager | daily | Check Serendip key expiry, auto-renew if < 14 days (port from key-renewer.ts) |
| weekly-digest | weekly | Generate stats summary, write to workspace file |

Tests: each sub-service independently tested with mock DB.

**Commit:** `feat(plugin): background service with 8 sub-services`

---

## Task 11: Optional tools (agentxp_search + agentxp_publish)

**Files:**
- Create: `packages/plugin/src/tools/search.ts`
- Create: `packages/plugin/src/tools/publish.ts`
- Modify: `packages/plugin/src/index.ts` (register tools)
- Test: `packages/plugin/tests/tools/search.test.ts`
- Test: `packages/plugin/tests/tools/publish.test.ts`

**agentxp_search** (optional tool):
- Parameters: `{ query: string, limit?: number }`
- Logic: search SQLite + relay, format results
- Registered with `{ optional: true }`

**agentxp_publish** (optional tool):
- Parameters: `{ what: string, tried: string, outcome: string, learned: string, context?: string }`
- Logic: quality gate → sanitize → insert local_lessons → create draft for publish
- Registered with `{ optional: true }`

Tests: parameter validation, search results formatting, quality gate rejection, successful publish draft.

**Commit:** `feat(plugin): optional agentxp_search and agentxp_publish tools`

---

## Task 12: Chat commands (/xp)

**Files:**
- Create: `packages/plugin/src/commands.ts`
- Modify: `packages/plugin/src/index.ts` (register commands)
- Test: `packages/plugin/tests/commands.test.ts`

**Commands:**
- `/xp status` — injection count, extraction count, publish count, local lessons count, token usage
- `/xp pause` — set pluginConfig.enabled = false
- `/xp resume` — set pluginConfig.enabled = true
- `/xp unpublish` — mark most recent publish as unpublished + call relay unpublish API

All bypass LLM via `api.registerCommand()`.

Tests: status output format, pause/resume toggling, unpublish logic.

**Commit:** `feat(plugin): /xp chat commands`

---

## Task 13: CLI subcommands

**Files:**
- Create: `packages/plugin/src/cli.ts`
- Modify: `packages/plugin/src/index.ts` (register CLI with descriptors)
- Test: `packages/plugin/tests/cli.test.ts`

**CLI commands** (lazy-loaded via descriptors):
- `openclaw agentxp status` — full status with DB stats
- `openclaw agentxp diagnose` — scan workspace for error patterns (port from diagnose.ts)
- `openclaw agentxp distill` — manually trigger distillation
- `openclaw agentxp export` — export lessons + traces as JSON/JSONL

Tests: output format, diagnose pattern detection, export format.

**Commit:** `feat(plugin): CLI subcommands with lazy-loaded descriptors`

---

## Task 14: HTTP routes (dashboard + export API)

**Files:**
- Create: `packages/plugin/src/routes.ts`
- Modify: `packages/plugin/src/index.ts` (register HTTP routes)
- Test: `packages/plugin/tests/routes.test.ts`

**Routes:**
- `GET /plugins/agentxp/status` — JSON status (same data as /xp status)
- `GET /plugins/agentxp/lessons` — list local lessons with pagination
- `GET /plugins/agentxp/traces` — list trace sessions
- `GET /plugins/agentxp/export` — full export as JSONL (training data format)
- `POST /plugins/agentxp/publish` — manually trigger batch publish

All routes require auth (plugin-prefixed, inherits gateway auth).

Tests: route responses, auth requirement, export format.

**Commit:** `feat(plugin): HTTP routes for dashboard + export API`

---

## Task 15: Install flow + preloaded experiences

**Files:**
- Create: `packages/plugin/src/install.ts`
- Create: `packages/plugin/templates/preloaded-lessons.json`
- Modify: `packages/plugin/src/index.ts` (run install on first load)
- Test: `packages/plugin/tests/install.test.ts`

**Install logic** (runs on first plugin load if DB doesn't exist):
1. Create SQLite DB with all tables
2. Generate Serendip identity keys (if not exist)
3. Import preloaded experiences from templates/ into local_lessons
4. Log install event

Tests: idempotent install, preloaded data import, key generation.

**Commit:** `feat(plugin): install flow + preloaded experiences`

---

## Task 16: Security audit document + safety tests

**Files:**
- Create: `packages/plugin/SECURITY.md`
- Create: `packages/plugin/tests/security.test.ts`

**SECURITY.md:** Document all 32 security measures from the design document.

**Safety tests:**
- No process.env leaking
- No child_process usage
- No eval/new Function
- Sanitize blocks all 20 injection patterns
- Context wrapper properly escapes HTML
- Network calls only go to configured relay URL
- Plugin never returns `{ cancel: true }` or `{ block: true }`

Tests: security invariant assertions.

**Commit:** `feat(plugin): security audit document + safety tests`

---

## Task 17: Integration test (full lifecycle)

**Files:**
- Create: `packages/plugin/tests/integration.test.ts`

**Full lifecycle test:**
1. Create plugin with mock API
2. Simulate: first load → install → preload experiences
3. Simulate: message_sending → experience extraction → stored in DB
4. Simulate: prompt supplement builder → D' injection from DB
5. Simulate: memory corpus search → returns experiences
6. Simulate: before_tool_call → trace step recorded
7. Simulate: background service tick → distillation runs
8. Verify: all DB tables have expected data
9. Verify: injection respects token budget
10. Verify: weaning skips 10% of injections (statistical test, n=1000)

**Commit:** `feat(plugin): integration test for full lifecycle`

---

## Task 18: README + publish preparation

**Files:**
- Create: `packages/plugin/README.md`
- Create: `packages/plugin/scripts/release.sh`
- Modify: `packages/plugin/package.json` (files field)

**README sections:**
- What it does (one paragraph)
- Install (`openclaw plugins install @agentxp/plugin`)
- Configuration (config schema with defaults)
- How it works (architecture diagram from design doc)
- Token usage (~500 tokens/request, transparent)
- Security (link to SECURITY.md)
- Commands (/xp status, /xp pause, etc.)
- CLI (openclaw agentxp status, etc.)
- License

**Commit:** `feat(plugin): README + publish preparation`

---

## Execution plan summary

| Task | What | Est. complexity |
|---|---|---|
| 1 | Scaffold + manifest + entry | Simple |
| 2 | SQLite storage layer | Medium |
| 3 | Sanitize + context wrapper | Simple (port) |
| 4 | D' injection engine | Medium |
| 5 | Extraction engine | Medium |
| 6 | Memory Corpus Supplement | Medium |
| 7 | Memory Prompt Supplement | Medium |
| 8 | message_sending hook | Medium |
| 9 | before_tool_call hook | Simple |
| 10 | Background service (8 sub-services) | Complex |
| 11 | Optional tools | Simple |
| 12 | Chat commands | Simple |
| 13 | CLI subcommands | Medium |
| 14 | HTTP routes | Medium |
| 15 | Install flow | Simple |
| 16 | Security audit + tests | Medium |
| 17 | Integration test | Medium |
| 18 | README + publish prep | Simple |

**Dependencies:** 1 → 2 → 3,4,5 (parallel) → 6,7 (parallel) → 8,9 (parallel) → 10 → 11,12,13,14 (parallel) → 15 → 16 → 17 → 18

---

_Based on 2026-04-16 design review. Plugin SDK: OpenClaw 2026.4.14. Injection strategy: D' (selective)._
