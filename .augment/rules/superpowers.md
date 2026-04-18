---
type: always_apply
description: Load superpowers skill library (global install) for this project
---

# Superpowers (Augment Adapter)

A global install of [obra/superpowers](https://github.com/obra/superpowers)
lives at `~/.superpowers/`. Its Augment-specific entry file is
`~/.superpowers/AUGMENT.md` — read it before any non-trivial task.

**Discovery CLI:** `~/.superpowers/bin/sp`
- `sp list` — all 14 skills with one-line descriptions
- `sp search <term>` — filter by keyword
- `sp read <name>` — print a skill's full `SKILL.md`
- `sp path <name>` — absolute path (use with the `view` tool)

**Invocation rule:** if there is a 1% chance a skill applies, check first
via `sp search`. If a skill matches, load it with
`~/.superpowers/bin/sp read <name>` through `launch-process`
(the `view` tool is restricted to the workspace root and cannot read
`~/.superpowers/...`). Announce `Using <name> skill to <purpose>`,
mirror its checklist into the task list, then follow the skill exactly.

**Precedence:** user instructions and `CLAUDE.md` override skills when they
conflict. See `~/.superpowers/AUGMENT.md` §"Platform notes" for tool-name
mapping (e.g., `Read` → `view`, `Bash` → `launch-process`).
