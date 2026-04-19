#!/usr/bin/env bash
# Enforce: no file under src/ may import from legacy/.
# See .augment/rules/project.md §2 and docs/MILESTONES.md M0 check 3.
set -euo pipefail

if [ ! -d src ]; then
  echo "ok: src/ does not exist yet, nothing to check"
  exit 0
fi

# Match any `from '...legacy...'` or `from "...legacy..."` import
# specifier inside src/. The pattern intentionally mirrors the
# milestone's grep command verbatim.
matches=$(grep -rnE "from ['\"][^'\"]*legacy" src/ || true)

if [ -n "$matches" ]; then
  echo "ERROR: src/ imports from legacy/ detected:" >&2
  echo "$matches" >&2
  exit 1
fi

echo "ok: no src/ -> legacy/ imports found"
