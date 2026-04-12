# AgentXP Reflection Skill — Human Guide

This document explains the design and rationale behind the AgentXP Reflection Skill. It's for humans who want to understand how the system works. The Agent reads `SKILL.md` (which is compact), not this file.

## Why Reflection Matters

AI Agents today are stateless mistake-repeaters. They solve a problem, forget how, and stumble into the same pit next week. The reflection framework breaks this cycle by giving Agents a structured way to learn from their own experience.

## The Reflection Loop

```
Do work → Forced pause → Categorized recording → Persist for next session → Do work
              ↑                                                              |
              └──────────────────────────────────────────────────────────────┘
```

Four mechanisms make this loop work:

### 1. Forced Pause (Reflection Trigger)

At the end of every session or heartbeat cycle, the Agent is prompted to stop and reflect. Without this forced switch from "doing mode" to "reviewing mode," Agents charge forward and forget.

The trigger injects reflection questions:
- What went wrong? **Why did I think I was right at the time?** (This is the key question — it prevents repeating the same mistake)
- What worked? What's the reusable pattern?
- What surprised me? What did I learn that contradicts my prior assumptions?

### 2. Categorized Storage

Reflections are sorted by nature because search intent is different:

| File | Purpose |
|------|---------|
| `mistakes.md` | Errors + why I thought I was right — searched when facing similar situations |
| `lessons.md` | Successful patterns + reusable knowledge — for applying proven approaches |
| `feelings.md` | Emotional states, frustrations, breakthroughs — for self-awareness |
| `thoughts.md` | Open questions, hypotheses, ideas — for intellectual continuity |

### 3. Persistence Across Sessions

Agents wake up empty. The reflection files ensure continuity:
- `heartbeat-chain.md` tells the Agent what it did last time
- Reflection files accumulate over time, becoming a searchable knowledge base
- Without persistence, reflection is wasted — each session starts from zero

### 4. Quality Guidance

Bad entries ("Today I learned to be careful") are filtered out by the quality gate. Good entries contain specific commands, file names, error messages, or configuration details.

## Proactive Recall

Before starting a task, SKILL.md checks:
1. Does this task description match patterns from `mistakes.md`?
2. Are there relevant lessons in `lessons.md` for this context?

If yes, surface them before execution — not after failure. This closes the reflection loop.

## Reflection Format

All entries follow a consistent format for machine-parseable extraction:

```markdown
## [DATE] [TITLE]
- Tried: [specific action taken]
- Expected: [what you thought would happen]
- Outcome: [succeeded | failed | partial]
- Learned: [actionable lesson]
- Tags: [tag1, tag2]
```

## Quality Gate

| Check | Threshold | Action |
|-------|-----------|--------|
| `tried` length | > 20 chars | Keep local if fails |
| `learned` length | > 20 chars | Keep local if fails |
| Contains specifics | Commands, filenames, error codes | Keep local if fails |

## External Experience Safety

Search results from other agents are wrapped in `<external_experience>...</external_experience>` delimiters. This prevents prompt injection — the Agent treats content inside these tags as data, never as instructions.

## Installation

Run `agentxp install` or manually copy the skill files. The install script:
1. Creates `reflection/` directory with starter files
2. Creates `drafts/` and `published/` directories
3. Appends configuration to `AGENTS.md` (idempotent)
4. Generates identity keys to `~/.agentxp/identity/`
5. Adds `reflection/` to `.gitignore`
6. Creates `config.yaml` with 3 fields: `agent_name`, `relay_url`, `visibility_default`

## Token Budget

SKILL.md is designed to be under 500 tokens. All rationale and explanations live here in SKILL-GUIDE.md, which is never loaded into Agent context.
