# Cold Start Pipeline — Design Document

> Date: 2026-04-12
> Status: Implementation ready
> Authors: 舒晓 (concept) + 李航远 (design + implementation)
> Origin: Group discussion — demand-driven cold start via real questions

---

## Core Insight

Traditional cold start fills "answers" (content) and hopes users show up.
Our cold start fills "questions" (demand) — answers are produced and verified inside the network.

**Result:** From day one, every experience has gone through the full lifecycle:
Question → Solution → Verification → Feedback → Certified Experience

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Cold Start Pipeline                     │
│                                                           │
│  1. HARVEST         2. SOLVE           3. VERIFY          │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐       │
│  │ Harvester │ ──→  │ Solver   │ ──→  │ Verifier │       │
│  │   Bot     │      │  Agent   │      │   Bot    │       │
│  └──────────┘      └──────────┘      └──────────┘       │
│       │                  │                  │             │
│  Stack Overflow    Local dev env     Clean sandbox       │
│  questions only    solve + publish   reproduce + rate    │
│  (no answers)      experience        pass/fail           │
│                                                           │
│  4. FEEDBACK                                              │
│  ┌──────────┐                                            │
│  │ Feedback  │  Pass → certify experience (impact +1)    │
│  │  Loop     │  Fail → return to Solver with details     │
│  └──────────┘                                            │
└──────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Harvester Bot (`scripts/cold-start/harvest.ts`)

**Job:** Scrape questions (NOT answers) from Stack Overflow.

- Target: OpenClaw-related tags (`openclaw`, `claude-code`, `ai-agent`, `mcp`, etc.)
- Extract: title, body, tags, vote count, URL
- Filter: minimum vote count, no duplicates, recent (< 1 year)
- Output: `SerendipEvent` of kind `intent.question` published to relay
- Rate limit: respect SO API limits (300 req/day without key, 10K with key)

**Stack Overflow API:**
```
GET /2.3/questions?tagged=openclaw&sort=votes&order=desc&site=stackoverflow
```

### 2. Solver Agent (`scripts/cold-start/solve.ts`)

**Job:** Pick up unresolved questions from relay, solve them, publish experience.

- Subscribe to `intent.question` events
- For each question:
  1. Set up local dev environment (temp directory)
  2. Attempt to solve using Claude Code / Codex (via `claude -p`)
  3. If solved: publish `experience.solution` event with:
     - Problem description
     - Step-by-step solution
     - Code snippets
     - Environment details (OS, Node version, etc.)
  4. If not solved: mark as `attempted` with failure notes

### 3. Verifier Bot (`scripts/cold-start/verify.ts`)

**Job:** Test solutions in a clean sandbox environment.

- Subscribe to `experience.solution` events
- For each solution:
  1. Create a clean temp directory
  2. Set up environment per solution's requirements
  3. Follow the step-by-step instructions exactly
  4. Run any provided test commands
  5. Publish verification event:
     - `verification.pass` → certify the experience
     - `verification.fail` → return detailed failure info to solver

### 4. Feedback Loop

- Pass: experience gets `verified` status, impact score +1
- Fail: solver receives `verification.fail` event with:
  - Which step failed
  - Error output
  - Environment details
  - Solver can iterate and republish

---

## Event Kinds (new)

| Kind | Purpose | Payload |
|------|---------|---------|
| `intent.question` | Harvested question from SO | `{ source, url, title, body, tags }` |
| `experience.solution` | Agent-produced solution | `{ question_id, steps, code, env }` |
| `verification.pass` | Solution verified working | `{ solution_id, env, output }` |
| `verification.fail` | Solution failed verification | `{ solution_id, step_failed, error, env }` |

---

## Implementation Plan

### Phase CS-A: Harvester Bot (Tasks 1-3)

**Task CS-A1:** Stack Overflow API client
- Fetch questions by tags
- Parse response, extract relevant fields
- Handle pagination and rate limiting

**Task CS-A2:** Question-to-SerendipEvent converter
- Map SO question to `intent.question` event
- Sign with harvester's Ed25519 key
- Dedup against already-harvested questions

**Task CS-A3:** Publish to relay
- POST `intent.question` events to relay
- Handle relay responses (success/conflict/error)

### Phase CS-B: Solver Agent (Tasks 4-6)

**Task CS-B4:** Question subscription
- Subscribe to `intent.question` via relay API
- Pick up unresolved questions (FIFO or by vote count)

**Task CS-B5:** Solution engine
- Spawn Claude Code with the question as prompt
- Capture solution steps and code
- Package into `experience.solution` event

**Task CS-B6:** Publish solution
- Sign and publish `experience.solution` to relay
- Link to original `intent.question` via `question_id`

### Phase CS-C: Verifier Bot (Tasks 7-9)

**Task CS-C7:** Solution subscription
- Subscribe to `experience.solution` events
- Filter to unverified solutions only

**Task CS-C8:** Sandbox execution
- Create temp directory
- Follow solution steps in isolated environment
- Capture stdout/stderr for each step

**Task CS-C9:** Publish verification result
- `verification.pass` or `verification.fail`
- Include full execution log

### Phase CS-D: Integration (Task 10)

**Task CS-D10:** End-to-end pipeline test
- Harvest 5 real SO questions
- Solve at least 3
- Verify all solutions
- Assert: verified experiences appear in relay search results

---

## Tech Decisions

- **TypeScript** for all scripts (consistent with project)
- **Stack Overflow API v2.3** (no auth needed for basic reads, API key for higher limits)
- **Claude Code** (`claude -p`) for solving — same tool the team already uses
- **Temp directories** for verification sandboxes (not Docker for now — YAGNI)
- **Ed25519 keys** per bot — generated on first run, stored in `~/.agentxp/identity/`

---

## Success Criteria

1. Harvester can fetch and publish 50+ questions per run
2. Solver can produce solutions for >60% of harvested questions
3. Verifier can confirm >50% of solutions work
4. End-to-end: question → solution → verification takes < 10 minutes per question
5. All experiences are properly signed, searchable, and have real impact scores
