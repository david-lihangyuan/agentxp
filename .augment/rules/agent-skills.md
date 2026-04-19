---
type: always_apply
description: Load addyosmani/agent-skills (global install) as a complement to superpowers
---

# Agent Skills (Augment Adapter)

A global install of [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
lives at `~/.agent-skills/`. This is a **complementary** skill library that
covers areas `obra/superpowers` does not (spec-driven development, task
breakdown, incremental delivery, ADRs, code review, security hardening, etc.).

**Install root:** `$HOME/.agent-skills` (full clone, ~800KB, MIT licensed).
**Skill format:** each skill is a directory under `skills/<name>/` with a
`SKILL.md` entry file. No CLI helper — read skills directly.

---

## How to invoke a skill (Augment Agent)

**Augment-specific constraint:** the `view` tool is restricted to the current
workspace root and cannot read files under `~/.agent-skills/...`. All skill
loading must go through `launch-process` with `cat` (or `ls`).

**Canonical invocation sequence**:

1. Before starting any non-trivial task, check relevance:
   ```bash
   ls ~/.agent-skills/skills/                           # full catalog (21 skills)
   grep -l "<keyword>" ~/.agent-skills/skills/*/SKILL.md  # filter by content
   ```
2. If a skill applies, load it:
   ```bash
   cat ~/.agent-skills/skills/<name>/SKILL.md
   ```
3. Announce: `Using agent-skills:<name> to <purpose>`.
4. If the skill contains a checklist or numbered steps, mirror it into the
   task list via `add_tasks` / `update_tasks`. Each checklist item becomes
   one task.
5. Follow the skill exactly. User instructions still take precedence when
   they conflict.

---

## Relationship to superpowers

Both skill libraries are active. When a skill name exists in **both**
(`test-driven-development`, `writing-plans` vs `planning-and-task-breakdown`,
etc.), prefer the `superpowers` version by default — it is the primary
workflow library referenced throughout this project. Use `agent-skills` for
the areas superpowers does not cover:

| BOOTSTRAP.md §3/§4 calls | Source |
|---|---|
| `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `writing-skills`, `using-git-worktrees`, `subagent-driven-development`, `dispatching-parallel-agents`, `systematic-debugging`, `finishing-a-development-branch`, `using-superpowers` | `~/.superpowers/skills/` (via `~/.superpowers/bin/sp`) |
| `spec-driven-development`, `planning-and-task-breakdown`, `incremental-implementation`, `documentation-and-adrs`, `code-review-and-quality` | `~/.agent-skills/skills/` (via `cat`) |

Full agent-skills catalog (21 total; bold = referenced by BOOTSTRAP):

```
idea-refine                         context-engineering
spec-driven-development   ★        source-driven-development
planning-and-task-breakdown   ★    frontend-ui-engineering
incremental-implementation   ★     api-and-interface-design
test-driven-development             browser-testing-with-devtools
debugging-and-error-recovery        code-review-and-quality   ★
code-simplification                 security-and-hardening
performance-optimization            git-workflow-and-versioning
ci-cd-and-automation                deprecation-and-migration
documentation-and-adrs   ★         shipping-and-launch
using-agent-skills
```

---

## Invocation rule

If there is a 1% chance a skill applies, check first via `ls` or `grep` on
`~/.agent-skills/skills/`. If a skill matches, load its `SKILL.md`, mirror
its checklist into the task list, then follow it exactly.

**Precedence (highest to lowest):**
1. Explicit user instructions in the current conversation
2. Project `CLAUDE.md` and in-repo rules (`.augment/rules/*.md`)
3. Skill contents (`superpowers` and `agent-skills`)

When two skills conflict, the more specific one wins; ties go to
`superpowers` (primary library).

---

## Updating

`~/.agent-skills/` is a git clone. To refresh:

```bash
cd ~/.agent-skills && git pull --ff-only
```

Do not modify files inside `~/.agent-skills/` — it is upstream content.
Project-specific overrides belong in `.augment/rules/` instead.
