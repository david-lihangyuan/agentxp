---
name: gstack
description: >
  MUST BE USED for QA testing, deployment verification, and UI dogfooding.
  Use PROACTIVELY when: testing a user flow, verifying a deployment, checking
  responsive layouts, testing forms, or filing bugs with evidence.
  NOT for: unit tests, API-only testing, or code implementation.
tools:
  - Bash
  - Read
---

# gstack — Headless Browser QA

Fast headless Chromium for QA testing. ~100ms per command after first start.

## Setup Check (run first)

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
B=""
[ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/browse/dist/browse" ] && B="$_ROOT/.claude/skills/gstack/browse/dist/browse"
[ -z "$B" ] && B=~/.claude/skills/gstack/browse/dist/browse
if [ -x "$B" ]; then
  echo "READY: $B"
else
  # Try workspace skills location
  WB="$HOME/.openclaw/workspace/skills/gstack/browse/dist/browse"
  if [ -x "$WB" ]; then
    B="$WB"
    echo "READY: $B"
  else
    echo "NEEDS_SETUP"
  fi
fi
```

If `NEEDS_SETUP`: build with `cd <skill-dir> && ./setup`

## Core Workflow: Test a User Flow

```bash
$B goto https://your-app.com
$B snapshot -i                    # see all interactive elements
$B fill @e3 "test@example.com"   # fill by ref
$B click @e5                     # click by ref
$B snapshot -D                   # diff — what changed?
$B is visible ".success"         # assert result
$B screenshot /tmp/result.png    # evidence
```

## Deployment Verification

```bash
$B goto https://relay.agentxp.io
$B text                          # page loads?
$B console                       # JS errors?
$B network                       # failed requests?
$B screenshot /tmp/prod-check.png
```

## Responsive Testing

```bash
$B goto https://your-app.com
$B responsive /tmp/layout        # mobile + tablet + desktop screenshots
```

## Key Commands

| Command | Description |
|---------|-------------|
| `goto <url>` | Navigate |
| `snapshot -i` | Interactive elements with @refs |
| `snapshot -D` | Diff vs previous |
| `click @eN` | Click element |
| `fill @eN <val>` | Fill input |
| `is visible <sel>` | Assert visibility |
| `screenshot [sel] [path]` | Screenshot |
| `console` | JS console messages |
| `network` | Network requests |
| `text` | Page text |

## Tips

1. **`snapshot -i` first** — see what's interactive before clicking
2. **`snapshot -D` to verify** — see exactly what changed after an action
3. **Check `console` after actions** — catch JS errors that don't surface visually
4. **Use `chain` for long flows** — single command, no per-step overhead
